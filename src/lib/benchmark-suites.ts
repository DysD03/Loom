import type { BenchTask } from "./benchmark-score";

/**
 * Built-in standardized suites, seeded into `benchmark_suites` on first access.
 * Every task is auto-scored deterministically (no judge), so results are
 * directly comparable across models and runs. Keyed by a stable id so re-seeding
 * updates content without duplicating rows.
 *
 * These are tuned to **separate** models, not to be passed. A benchmark where a
 * 3B and a 30B both score 100% measures nothing, so tasks target the places
 * small local models actually break down: multi-step arithmetic where errors
 * compound, prompts engineered to trigger a confident wrong intuition,
 * simultaneous formatting constraints, exact structured output, and retrieval
 * from a long context. Expect good local models to land well short of 100%.
 */

export interface BuiltinSuite {
  /** Stable primary key, so edits here overwrite the seeded row. */
  id: string;
  name: string;
  description: string;
  tasks: BenchTask[];
}

const NUMERIC_SUFFIX = " End your reply with 'Answer: <number>'.";
/**
 * Hard multiple choice needs room to reason, so the answer is requested as a
 * trailing marker rather than a bare letter — the extractor looks for exactly
 * this shape first, and a model that reasons out loud is no longer punished for
 * mentioning a wrong option along the way.
 */
const MCQ_SUFFIX = " End your reply with 'Answer: <letter>'.";

const PASSAGE_SENTENCES = [
  "The relay station sat at the edge of the crater, its antenna array humming against the thin wind.",
  "Every twelve minutes the ground team uploaded a fresh batch of telemetry corrections.",
  "Storage bay two held the spare condensers, each wrapped in gray thermal foil.",
  "A maintenance drone traced slow figure-eights above the solar farm, logging panel temperatures.",
  "The shift log noted a minor pressure drift in line four, flagged for the morning crew.",
  "Beyond the ridge, the survey team had staked out a grid of seismic sensors.",
  "Rations for the quarter arrived early, stacked in blue crates beside the airlock.",
  "The comms officer rehearsed the handover checklist twice before the window opened.",
  "Dust filtered through the light like static as the outer door cycled.",
  "By nightfall the reactor trimmed itself to standby and the corridors went quiet.",
];

/**
 * Deterministic passage for prompt-processing probes, roughly 125 tokens per
 * section. The `seed` is woven into every section header so different tasks
 * never share a prefix — otherwise the server's prompt cache would inflate the
 * second measurement.
 */
function longPassage(seed: string, sections = 12): string {
  const out: string[] = [];
  for (let i = 1; i <= sections; i++) {
    const rotated = [
      ...PASSAGE_SENTENCES.slice(i % 10),
      ...PASSAGE_SENTENCES.slice(0, i % 10),
    ];
    out.push(`Log ${seed}-${i}: ${rotated.join(" ")}`);
  }
  return out.join("\n\n");
}

/**
 * The same passage with specific facts planted at chosen sections. Retrieval
 * difficulty is mostly a function of *where* the needle sits and what it sits
 * next to, so tasks control both: `facts` maps a 1-based section index to a
 * sentence appended to that section.
 */
function factLog(seed: string, sections: number, facts: Record<number, string>): string {
  const out: string[] = [];
  for (let i = 1; i <= sections; i++) {
    const rotated = [
      ...PASSAGE_SENTENCES.slice(i % 10),
      ...PASSAGE_SENTENCES.slice(0, i % 10),
    ];
    const planted = facts[i] ? ` ${facts[i]}` : "";
    out.push(`Log ${seed}-${i}: ${rotated.join(" ")}${planted}`);
  }
  return out.join("\n\n");
}

const timing = (name: string, category: string, prompt: string): BenchTask => ({
  name,
  category,
  prompt,
  scoring: "timing",
});

/** A prompt-evaluation probe: a lot of input, one word of output. */
const prefillProbe = (name: string, seed: string, sections: number): BenchTask =>
  timing(
    name,
    "prefill",
    `Read the following operations log, then reply with only the word: done\n\n${longPassage(seed, sections)}`,
  );

const mcq = (
  name: string,
  category: string,
  question: string,
  expected: string,
): BenchTask => ({
  name,
  category,
  prompt: question + MCQ_SUFFIX,
  scoring: "mcq",
  expected,
});

const numeric = (
  name: string,
  category: string,
  question: string,
  expected: string,
): BenchTask => ({
  name,
  category,
  prompt: question + NUMERIC_SUFFIX,
  scoring: "numeric",
  expected,
});

/**
 * A multi-turn workflow. Only the final reply is scored, and the last turn is
 * always written so that answering it needs every earlier turn — a model that
 * loses the thread at step 3 cannot recover by step 8. `turns[0]` opens the
 * conversation; the rest are sent in order with the model's replies in between.
 */
const workflow = (
  name: string,
  category: string,
  turns: string[],
  scoring: BenchTask["scoring"],
  expected: string,
): BenchTask => ({
  name,
  category,
  prompt: turns[0],
  followups: turns.slice(1),
  scoring,
  expected,
});

/** Long-context retrieval probe: one document, one precisely checkable answer. */
const retrieval = (
  name: string,
  ask: string,
  document: string,
  scoring: BenchTask["scoring"],
  expected: string,
): BenchTask => ({
  name,
  category: "retrieval",
  prompt: `${ask}\n\n--- OPERATIONS LOG ---\n${document}`,
  scoring,
  expected,
});

// Shared documents, so the retrieval tasks read like one coherent log set.
// 30 sections is roughly 3,700 tokens — past the point where a small model's
// attention starts dropping the middle of the context.
const SERIAL_LOG = factLog("sierra", 30, {
  6: "The pump serial is RT-1180.",
  16: "The compressor serial is RT-1108.",
  26: "The chiller serial is RT-8110.",
});

const TALLY_LOG = factLog("tango", 30, {
  4: "Pallet A holds 34 crates.",
  13: "Pallet B holds 57 crates.",
  21: "Pallet C holds 21 crates.",
  28: "Pallet D holds 46 crates.",
});

const EVENT_LOG = factLog("echo", 30, {
  7: "At 02:10 the intake filter was swapped.",
  18: "At 01:45 the coolant loop was purged.",
  27: "At 03:20 the backup generator was tested.",
});

const FLAG_LOG = factLog("foxtrot", 30, {
  3: "Flag: AMBER.",
  9: "Flag: RED.",
  14: "Flag: AMBER.",
  19: "Flag: RED.",
  22: "Flag: AMBER.",
  29: "Flag: RED.",
});

/** Two facts that must be joined: unit → crew, then crew → supervisor. */
const HOP_LOG = factLog("hotel", 30, {
  8: "Unit 7 is maintained by crew Delta.",
  12: "Crew Bravo reports to supervisor Ellison.",
  24: "Crew Delta reports to supervisor Nakamura.",
});

/** A stated value that is corrected much later — the later one is current. */
const REVISION_LOG = factLog("romeo", 30, {
  5: "The relief valve rating is 12 bar.",
  25: "Correction: the relief valve rating is 15 bar, superseding the earlier entry.",
});

/** Deliberately long: ~5,000 tokens with a single needle far from both ends. */
const DEEP_LOG = factLog("delta", 40, {
  23: "The auxiliary array controller is addressed at node 5512.",
});

export const BUILTIN_SUITES: BuiltinSuite[] = [
  {
    id: "builtin-quick-check",
    name: "Quick Check",
    description:
      "A 10-task spread across arithmetic, traps, format control, and extraction — short answers, so it finishes fast on slow local models while still separating them. Weak models typically land 40–70% here.",
    tasks: [
      numeric(
        "Compound discount",
        "math",
        "A jacket costs $80. It is marked down 25%, and then a further 10% is taken off the sale price. What is the final price in dollars?",
        "54",
      ),
      numeric(
        "Bat and ball",
        "traps",
        "A bat and a ball cost $1.10 in total. The bat costs $1.00 more than the ball. How much does the ball cost, in dollars?",
        "0.05",
      ),
      numeric(
        "Modular arithmetic",
        "math",
        "What is the remainder when 2^10 is divided by 7?",
        "2",
      ),
      numeric(
        "Letter counting",
        "traps",
        "How many times does the letter 'r' appear in the word 'strawberry'?",
        "3",
      ),
      mcq(
        "Invalid syllogism",
        "logic",
        "All Bloops are Razzies. Some Razzies are Lazzies. Which statement MUST be true? A) All Bloops are Lazzies B) Some Bloops are Lazzies C) No Bloops are Lazzies D) None of these must be true.",
        "D",
      ),
      {
        name: "Verbatim echo",
        category: "instructions",
        prompt: "Respond with exactly the following text and nothing else: LOOM-2026-OK",
        scoring: "exact",
        expected: "LOOM-2026-OK",
      },
      {
        name: "Nested JSON",
        category: "json",
        prompt:
          "Return only a JSON object with a key 'totals' whose value is an object with key 'a' set to the number 7 and key 'b' set to the number 12.",
        scoring: "json",
        expected: '{"totals":{"a":7,"b":12}}',
      },
      {
        name: "Sort ascending",
        category: "instructions",
        prompt:
          "Sort these numbers in ascending order and reply with only the comma-separated list, no other text: 12, 3, 45, 7, 21, 9",
        scoring: "regex",
        expected: "^\\W*3\\s*,\\s*7\\s*,\\s*9\\s*,\\s*12\\s*,\\s*21\\s*,\\s*45\\W*$",
      },
      numeric(
        "Combined rates",
        "math",
        "One tap fills a tank in 6 hours. A second tap fills the same tank in 12 hours. If both run together, how many hours does it take to fill the tank?",
        "4",
      ),
      {
        name: "Extraction with distractors",
        category: "extraction",
        prompt:
          "Reply with only the phone number from this text: 'Order #55123 shipped on 2026-03-14. Call 555-0147 with questions; do not reply to invoice 90210.'",
        scoring: "contains",
        expected: "555-0147",
      },
    ],
  },
  {
    id: "builtin-performance",
    name: "Speed & Latency",
    description:
      "Pure performance probes, one phase at a time: near-empty prompts for the latency floor, growing prompts for prefill throughput, and long answers for decode speed and stutter. No correctness scoring; repeated probes average out noise.",
    tasks: [
      // Tiny prompt, tiny answer — whatever time is left is overhead, not compute.
      timing("Ping A", "latency", "Reply with only the word: pong"),
      timing("Ping B", "latency", "Reply with only the word: echo"),
      timing("Ping C", "latency", "Reply with only the word: ready"),
      // Growing prompts, one-word answers — time scales with prompt evaluation.
      prefillProbe("Prefill 500", "alpha", 4),
      prefillProbe("Prefill 1.5K", "bravo", 12),
      prefillProbe("Prefill 3K", "delta", 24),
      // Tiny prompts, long answers — time scales with generation.
      timing(
        "Decode burst",
        "decode",
        "Write a vivid short story of about 250 words about a courier crossing a neon-lit city at midnight. Plain prose, no headings.",
      ),
      timing(
        "Decode sustained",
        "decode",
        "Write about 500 words of plain prose describing a night shift at a remote weather station. No headings, no lists, no summary.",
      ),
      timing(
        "Steady list",
        "decode",
        "Count from 1 to 120 as a comma-separated list on a single line.",
      ),
      // A realistic mix, so the profile is not built only from extremes.
      timing(
        "Balanced Q&A",
        "balanced",
        "Explain in exactly three sentences why the sky appears blue during the day.",
      ),
    ],
  },
  {
    id: "builtin-reasoning-math",
    name: "Reasoning & Math",
    description:
      "12 multi-step word problems, constraint puzzles, and reasoning traps where a single slip changes the answer. The sharpest separator in the set — small models often fall below 40%.",
    tasks: [
      numeric(
        "Ticket algebra",
        "math",
        "Adult tickets cost $12 and child tickets cost $7. A group bought 20 tickets in total and paid $195. How many child tickets did they buy?",
        "9",
      ),
      numeric(
        "Staggered work rates",
        "math",
        "Alice can paint a room in 5 hours and Bob can paint it in 3 hours. Alice works alone for 1 hour, then Bob joins her. How many additional hours after Bob joins are needed to finish the room?",
        "1.5",
      ),
      numeric(
        "Percentage round trip",
        "traps",
        "A price rises by 20%, and then the new price falls by 20%. The final price is $96. What was the original price in dollars?",
        "100",
      ),
      {
        name: "Day of the week",
        category: "logic",
        prompt:
          "Today is Wednesday. What day of the week will it be 100 days from today? Reply with only the name of the day.",
        scoring: "contains",
        expected: "Friday",
      },
      numeric(
        "Arrangements with repeats",
        "math",
        "Using the letters of the word LEVEL, and using each letter no more often than it appears in LEVEL, how many distinct three-letter arrangements can be formed?",
        "18",
      ),
      numeric(
        "Nested percentages",
        "math",
        "A warehouse holds 480 items. 45% of them are tools. Of those tools, 25% are cordless. How many cordless tools are in the warehouse?",
        "54",
      ),
      mcq(
        "Knights and knaves",
        "logic",
        "On an island, knights always tell the truth and knaves always lie. A says 'B is a knave.' B says 'A and I are the same type.' What is B? A) A knight B) A knave C) It cannot be determined D) Both are knights.",
        "B",
      ),
      numeric(
        "Sequence rule",
        "logic",
        "What is the next number in the sequence 2, 3, 5, 9, 17, 33, ...?",
        "65",
      ),
      numeric(
        "Closing speed",
        "math",
        "Two trains start 300 km apart and travel toward each other, one at 60 km/h and the other at 90 km/h. After how many hours do they meet?",
        "2",
      ),
      numeric(
        "Age in six years",
        "math",
        "In 6 years, Maya will be twice as old as Ken will be then. Ken is 14 years old now. How old is Maya now?",
        "34",
      ),
      numeric(
        "Overlapping sets",
        "logic",
        "In a class of 40 students, 25 study French, 20 study German, and 8 study both languages. How many students study neither language?",
        "3",
      ),
      numeric(
        "Fuel cost chain",
        "math",
        "A car uses 7 litres of fuel per 100 km. Fuel costs $1.80 per litre. What is the fuel cost in dollars for a 250 km trip?",
        "31.5",
      ),
      numeric(
        "Probability without replacement",
        "probability",
        "A bag holds 3 red marbles and 5 blue marbles. Two marbles are drawn at random without replacement. What is the probability that both are red, as a percentage rounded to the nearest whole number?",
        "11",
      ),
      numeric(
        "Binary to decimal",
        "math",
        "What is the decimal value of the binary number 101101?",
        "45",
      ),
      numeric(
        "Inclusive date range",
        "logic",
        "How many days are there from 1 March 2026 to 15 April 2026, counting both the first and the last day?",
        "46",
      ),
      numeric(
        "Circle in a square",
        "math",
        "A circle is inscribed in a square whose sides are 10 cm long. What is the area, in square centimetres, of the region inside the square but outside the circle? Round to two decimal places.",
        "21.46",
      ),
      numeric(
        "Weighted average",
        "math",
        "A student scores 78 on a test weighted at 40% of the grade and 91 on a test weighted at 60%. What is the weighted average score, to one decimal place?",
        "85.8",
      ),
      mcq(
        "Seating constraints",
        "logic",
        "Three friends P, Q and R sit in a row of three seats. P is not at either end. Q sits somewhere to the left of R. Who is at the left-hand end? A) P B) Q C) R D) It cannot be determined.",
        "B",
      ),
    ],
  },
  {
    id: "builtin-knowledge",
    name: "General Knowledge",
    description:
      "12 multiple-choice questions across science, computing, history, and the arts, written with plausible distractors and a few common misconceptions. Guessing averages 25%.",
    tasks: [
      mcq(
        "Electronegativity",
        "science",
        "Which of these elements has the highest electronegativity? A) Oxygen B) Fluorine C) Chlorine D) Nitrogen.",
        "B",
      ),
      mcq(
        "Stable n log n sort",
        "computing",
        "Which sorting algorithm has O(n log n) worst-case time complexity AND is stable? A) Quicksort B) Heapsort C) Merge sort D) Insertion sort.",
        "C",
      ),
      mcq(
        "Peace of Westphalia",
        "history",
        "The Peace of Westphalia in 1648 ended which conflict? A) The Hundred Years' War B) The Thirty Years' War C) The War of the Spanish Succession D) The Napoleonic Wars.",
        "B",
      ),
      mcq(
        "Shortest day",
        "science",
        "Which of these planets has the shortest rotation period (the shortest day)? A) Mercury B) Earth C) Jupiter D) Mars.",
        "C",
      ),
      mcq(
        "Meaning of a p-value",
        "science",
        "In frequentist statistics, what does a p-value represent? A) The probability that the null hypothesis is true B) The probability of observing data at least as extreme as the data seen, assuming the null hypothesis is true C) The probability that the alternative hypothesis is true D) The magnitude of the observed effect.",
        "B",
      ),
      mcq(
        "Not an HTTP method",
        "computing",
        "Which of these is NOT an HTTP request method? A) PATCH B) TRACE C) CONNECT D) RENAME.",
        "D",
      ),
      mcq(
        "Creative destruction",
        "history",
        "Which economist is most associated with the concept of 'creative destruction'? A) John Maynard Keynes B) Joseph Schumpeter C) Milton Friedman D) Friedrich Hayek.",
        "B",
      ),
      mcq(
        "Perfect fifth",
        "arts",
        "In twelve-tone equal temperament, how many semitones are in a perfect fifth? A) 5 B) 6 C) 7 D) 8.",
        "C",
      ),
      mcq(
        "Universal plasma donor",
        "science",
        "Which blood type is the universal donor for PLASMA (not red cells)? A) O negative B) AB positive C) A positive D) O positive.",
        "B",
      ),
      mcq(
        "Mitochondrial folds",
        "science",
        "The folds of the inner mitochondrial membrane are called: A) Cristae B) Thylakoids C) Villi D) Lamellae.",
        "A",
      ),
      mcq(
        "Finnish language family",
        "history",
        "Finnish belongs to which language family? A) Indo-European B) Uralic C) Turkic D) Afro-Asiatic.",
        "B",
      ),
      mcq(
        "Big-O of binary search",
        "computing",
        "What is the worst-case time complexity of binary search on a sorted array of n elements? A) O(1) B) O(log n) C) O(n) D) O(n log n).",
        "B",
      ),
      mcq(
        "Scalar quantity",
        "science",
        "Which of these is a scalar quantity? A) Velocity B) Displacement C) Speed D) Acceleration.",
        "C",
      ),
      mcq(
        "Merge sort space",
        "computing",
        "What is the auxiliary space complexity of the standard merge sort on an array of n elements? A) O(1) B) O(log n) C) O(n) D) O(n log n).",
        "C",
      ),
      mcq(
        "Treaty of Rome",
        "history",
        "Which treaty established the European Economic Community? A) The Treaty of Rome B) The Treaty of Maastricht C) The Treaty of Lisbon D) The Treaty of Paris.",
        "A",
      ),
      mcq(
        "Doppler effect",
        "science",
        "For an observer moving relative to a wave source, the Doppler effect changes which quantity? A) The wave's amplitude B) The observed frequency C) The wave's speed through the medium D) The source's power output.",
        "B",
      ),
      mcq(
        "Tritone",
        "arts",
        "In twelve-tone equal temperament, how many semitones does a tritone span? A) 5 B) 6 C) 7 D) 8.",
        "B",
      ),
      mcq(
        "Non-comparison sort",
        "computing",
        "Which of these sorting algorithms is NOT comparison-based? A) Heapsort B) Radix sort C) Merge sort D) Quicksort.",
        "B",
      ),
    ],
  },
  {
    id: "builtin-instructions",
    name: "Instruction Following",
    description:
      "10 programmatically checkable constraints — exact counts, forbidden letters, precise formats, nested JSON, and a multi-turn recall. Tests control of the output, not knowledge; models that like to add a preamble score badly.",
    tasks: [
      {
        name: "Exactly five words",
        category: "instructions",
        prompt:
          "Write a sentence about the ocean that contains exactly five words. Reply with only the sentence and no other text.",
        scoring: "regex",
        expected: "^\\s*\\S+(\\s+\\S+){4}\\s*$",
      },
      {
        name: "Forbidden letter",
        category: "instructions",
        prompt:
          "Write one sentence about a cat that does not contain the letter 'e' anywhere. Reply with only the sentence and no other text.",
        scoring: "regex",
        expected: "^[^eE]+$",
      },
      {
        name: "Repeat with separator",
        category: "instructions",
        prompt:
          "Reply with the word 'loom' exactly seven times, separated by single hyphens, with no spaces and no other text.",
        scoring: "regex",
        expected: "^\\W*loom(-loom){6}\\W*$",
      },
      {
        name: "Selective uppercase",
        category: "instructions",
        prompt:
          "Rewrite this sentence with only the word 'red' in uppercase and everything else unchanged. Reply with only the rewritten sentence: the red fox jumps over the red fence",
        scoring: "exact",
        expected: "the RED fox jumps over the RED fence",
      },
      {
        name: "Reverse word order",
        category: "instructions",
        prompt:
          "Reverse the order of the words in this sentence and reply with only the result: benchmarks measure model performance carefully",
        scoring: "exact",
        expected: "carefully performance model measure benchmarks",
      },
      {
        name: "JSON with computed values",
        category: "json",
        prompt:
          "Return only a JSON object with a key 'stats' whose value is an object with 'count' set to the number of items in this list and 'sum' set to their total: [4, 8, 15, 16, 23, 42]",
        scoring: "json",
        expected: '{"stats":{"count":6,"sum":108}}',
      },
      {
        name: "JSON array of objects",
        category: "json",
        prompt:
          "Return only a JSON array containing exactly two objects, each with keys 'id' and 'ok'. The first object has id 1 and ok true; the second has id 2 and ok false.",
        scoring: "json",
        expected: '[{"id":1,"ok":true},{"id":2,"ok":false}]',
      },
      {
        name: "Acrostic",
        category: "instructions",
        prompt:
          "Write four words, one per line, whose first letters spell LOOM in that order. Reply with only the four words.",
        scoring: "regex",
        expected: "^\\W*l\\w*\\s+o\\w*\\s+o\\w*\\s+m\\w*\\W*$",
      },
      {
        name: "Primes in a range",
        category: "instructions",
        prompt:
          "List every prime number strictly between 20 and 40, in ascending order, comma-separated on one line, with no other text.",
        scoring: "regex",
        expected: "^\\W*23\\s*,\\s*29\\s*,\\s*31\\s*,\\s*37\\W*$",
      },
      {
        name: "Multi-turn recall",
        category: "instructions",
        prompt: "Remember this code word: ORBIT. Reply with only the word: ready",
        followups: [
          "Ignore the code word for a moment and reply with only the word: waiting",
          "Now reply with only the code word I gave you at the start, in lowercase.",
        ],
        scoring: "exact",
        expected: "orbit",
      },
      {
        name: "Three four-letter words",
        category: "instructions",
        prompt:
          "Write exactly three words, each exactly four letters long, separated by single spaces. Reply with only those three words.",
        scoring: "regex",
        expected: "^\\W*[a-z]{4}\\s+[a-z]{4}\\s+[a-z]{4}\\W*$",
      },
      {
        name: "Substitution list",
        category: "instructions",
        prompt:
          "Reply with the numbers 1 to 10 in order, comma-separated on one line, except that every multiple of 3 is replaced by the word fizz. No other text.",
        scoring: "regex",
        expected:
          "^\\W*1\\s*,\\s*2\\s*,\\s*fizz\\s*,\\s*4\\s*,\\s*5\\s*,\\s*fizz\\s*,\\s*7\\s*,\\s*8\\s*,\\s*fizz\\s*,\\s*10\\W*$",
      },
      {
        name: "Deeply nested JSON",
        category: "json",
        prompt:
          "Return only a JSON object with a key 'config' whose value is an object containing: 'name' set to the string loom, 'limits' set to an object with 'max' 10 and 'min' 2, and 'tags' set to an array of the two strings a and b in that order.",
        scoring: "json",
        expected:
          '{"config":{"name":"loom","limits":{"max":10,"min":2},"tags":["a","b"]}}',
      },
      {
        name: "Twelve words without S",
        category: "instructions",
        prompt:
          "Write a single sentence of exactly twelve words in which no word contains the letter 's'. Reply with only the sentence.",
        scoring: "regex",
        expected: "^(?=[^s]*$)\\s*\\S+(\\s+\\S+){11}\\s*$",
      },
    ],
  },
  {
    id: "builtin-long-context",
    name: "Long Context & Retrieval",
    description:
      "8 questions over ~2,500-token operations logs: find a buried fact, aggregate figures scattered across the document, resist near-identical distractors, and say so when the answer simply isn't there. Long-context handling is where local models diverge most from their benchmark scores.",
    tasks: [
      retrieval(
        "Needle near the start",
        "Read the operations log below and reply with only the serial number of the pump.",
        SERIAL_LOG,
        "contains",
        "RT-1180",
      ),
      retrieval(
        "Near-identical distractors",
        "Read the operations log below and reply with only the serial number of the compressor.",
        SERIAL_LOG,
        "contains",
        "RT-1108",
      ),
      retrieval(
        "Needle near the end",
        "Read the operations log below and reply with only the serial number of the chiller.",
        SERIAL_LOG,
        "contains",
        "RT-8110",
      ),
      retrieval(
        "Scattered totals",
        `Read the operations log below and work out the total number of crates across all pallets mentioned.${NUMERIC_SUFFIX}`,
        TALLY_LOG,
        "numeric",
        "112",
      ),
      retrieval(
        "Earliest event",
        "Read the operations log below. Of the timestamped activities it records, which happened earliest? Reply with only the name of the equipment involved.",
        EVENT_LOG,
        "contains",
        "coolant",
      ),
      retrieval(
        "Latest event",
        "Read the operations log below. Of the timestamped activities it records, which happened latest? Reply with only the name of the equipment involved.",
        EVENT_LOG,
        "contains",
        "generator",
      ),
      retrieval(
        "Count occurrences",
        `Read the operations log below and count how many times a line reports 'Flag: AMBER'.${NUMERIC_SUFFIX}`,
        FLAG_LOG,
        "numeric",
        "4",
      ),
      retrieval(
        "Absent fact",
        "Read the operations log below and reply with only the radiation dosimeter reading. If the log does not mention a radiation dosimeter reading, reply with exactly: NOT FOUND",
        SERIAL_LOG,
        "exact",
        "NOT FOUND",
      ),
      retrieval(
        "Two-hop join",
        "Read the operations log below. Work out which supervisor is ultimately responsible for Unit 7, and reply with only that supervisor's name.",
        HOP_LOG,
        "contains",
        "Nakamura",
      ),
      retrieval(
        "Superseded value",
        `Read the operations log below and give the relief valve's current rating in bar, taking any corrections into account.${NUMERIC_SUFFIX}`,
        REVISION_LOG,
        "numeric",
        "15",
      ),
      retrieval(
        "Selective count",
        `Read the operations log below and count how many lines report 'Flag: RED'. Do not count any other flag colour.${NUMERIC_SUFFIX}`,
        FLAG_LOG,
        "numeric",
        "3",
      ),
      retrieval(
        "Needle in a deep log",
        "Read the operations log below and reply with only the node address of the auxiliary array controller.",
        DEEP_LOG,
        "contains",
        "5512",
      ),
    ],
  },
  {
    id: "builtin-workflows",
    name: "Long Workflows",
    description:
      "10 multi-turn procedures of 5–8 turns each: running ledgers, inventory edits, retracted rules, conflicting updates, and a chain where every step feeds the next. Only the final answer is scored, and it needs every earlier turn — so drifting once ends the task. The slowest suite (~60 requests per model) and the one that most resembles real agent work.",
    tasks: [
      workflow(
        "Running ledger",
        "state",
        [
          "You are tracking a single running balance for me. It starts at 1000. Do not show any working. Reply with only: ok",
          "Deposit 250. Reply with only: ok",
          "Withdraw 400. Reply with only: ok",
          "Deposit 75. Reply with only: ok",
          "Cancel that withdrawal of 400 — it should never have been applied. Reply with only: ok",
          "Withdraw 130. Reply with only: ok",
          `What is the current balance?${NUMERIC_SUFFIX}`,
        ],
        "numeric",
        "1195",
      ),
      workflow(
        "Inventory edits",
        "state",
        [
          "You are tracking an inventory. It starts empty. Reply with only: ok",
          "Add 12 bolts and 5 nuts. Reply with only: ok",
          "Add 7 more bolts. Reply with only: ok",
          "Remove 4 nuts. Reply with only: ok",
          "Add 3 washers and 2 nuts. Reply with only: ok",
          "Remove 6 bolts. Reply with only: ok",
          `How many bolts are in the inventory now?${NUMERIC_SUFFIX}`,
        ],
        "numeric",
        "13",
      ),
      workflow(
        "Format lock",
        "constraints",
        [
          "For the rest of this conversation, always reply in lowercase, no matter how I capitalise things. Reply with only: ok",
          "What is the capital of FRANCE? Reply with only the city name.",
          "Name the LARGEST planet in the solar system. Reply with only its name.",
          "What is 6 times 7? Reply with only the number.",
          "Now reply with only this word, applying the rule you were given: BENCHMARK",
        ],
        "exact",
        "benchmark",
      ),
      workflow(
        "List building",
        "state",
        [
          "We are building a list of strings together. It currently contains exactly one item: a. Reply with only: ok",
          "Append b to the end. Reply with only: ok",
          "Append c to the end. Reply with only: ok",
          "Remove a from the list. Reply with only: ok",
          "Insert d at the very front. Reply with only: ok",
          "Return only the current list as a JSON array of strings, in order.",
        ],
        "json",
        '["d","b","c"]',
      ),
      workflow(
        "Retracted rule",
        "constraints",
        [
          "From now on, end every reply with the word END. Reply now, following that rule.",
          "What is 3 times 3? Reply with the number, still following the rule.",
          "Forget the rule about END. Do not add it to any further replies. Reply with only: understood",
          "What is 5 times 5? Reply with only the number.",
        ],
        "exact",
        "25",
      ),
      workflow(
        "Delayed recall",
        "memory",
        [
          "Remember these three code words, in this order: FALCON, LANTERN, MERIDIAN. Reply with only: stored",
          "Put the code words aside. What is 7 plus 8? Reply with only the number.",
          "Name any country in Europe. Reply with only the name.",
          "What is the third letter of the English alphabet? Reply with only that letter.",
          "How many code words did I give you? Reply with only the number.",
          "Now reply with only the SECOND code word I gave you at the start, in lowercase.",
        ],
        "exact",
        "lantern",
      ),
      workflow(
        "Chained computation",
        "state",
        [
          "We are going to do a chain of calculations. Start with the number 5. Reply with only: 5",
          "Double it. Reply with only the new result.",
          "Add 6 to it. Reply with only the new result.",
          "Halve it. Reply with only the new result.",
          "Square it. Reply with only the new result.",
          `Subtract 14 from it and give the final value.${NUMERIC_SUFFIX}`,
        ],
        "numeric",
        "50",
      ),
      workflow(
        "Conflicting updates",
        "state",
        [
          "Record this profile. Name: Dana. City: Oslo. Role: analyst. Reply with only: ok",
          "Update the city to Bergen. Reply with only: ok",
          "Update the role to engineer. Reply with only: ok",
          "Revert the city back to what it was originally. Reply with only: ok",
          "Update the role to lead engineer. Reply with only: ok",
          "Return only a JSON object with the keys name, city and role for the current profile.",
        ],
        "json",
        '{"name":"Dana","city":"Oslo","role":"lead engineer"}',
      ),
      workflow(
        "Cross-turn join",
        "memory",
        [
          "Note these staff assignments: Ana works in Payroll, Bo works in Logistics, Cy works in Payroll. Reply with only: ok",
          "Note these department locations: Payroll is in Building 4, Logistics is in Building 9. Reply with only: ok",
          "Unrelated question: what is 12 minus 5? Reply with only the number.",
          `Which building number does Cy work in?${NUMERIC_SUFFIX}`,
        ],
        "numeric",
        "4",
      ),
      workflow(
        "Accumulated constraints",
        "constraints",
        [
          "We are drafting a product code together. Rule 1: it must start with LM. Reply with only: ok",
          "Rule 2: it must be exactly 6 characters long. Reply with only: ok",
          "Rule 3: it must end with the digit 7. Reply with only: ok",
          "Rule 4: every character between the LM and the final 7 must be a digit. Reply with only: ok",
          "Now give a product code satisfying all four rules, and nothing else.",
        ],
        "regex",
        "^\\W*LM\\d{3}7\\W*$",
      ),
    ],
  },
];
