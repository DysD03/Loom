import type { BenchTask } from "./benchmark-score";

/**
 * Built-in standardized suites, seeded into `benchmark_suites` on first access.
 * Every task is auto-scored deterministically (no judge), so results are
 * directly comparable across models and runs. Keyed by a stable id so re-seeding
 * updates content without duplicating rows.
 */

export interface BuiltinSuite {
  /** Stable primary key, so edits here overwrite the seeded row. */
  id: string;
  name: string;
  description: string;
  tasks: BenchTask[];
}

const NUMERIC_SUFFIX = " End your reply with 'Answer: <number>'.";
const MCQ_SUFFIX = " Respond with only the letter of the correct answer.";

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
    const rotated = [...PASSAGE_SENTENCES.slice(i % 10), ...PASSAGE_SENTENCES.slice(0, i % 10)];
    out.push(`Log ${seed}-${i}: ${rotated.join(" ")}`);
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

const mcq = (name: string, question: string, expected: string): BenchTask => ({
  name,
  category: "knowledge",
  prompt: question + MCQ_SUFFIX,
  scoring: "mcq",
  expected,
});

export const BUILTIN_SUITES: BuiltinSuite[] = [
  {
    id: "builtin-quick-check",
    name: "Quick Check",
    description:
      "A 10-task smoke test across arithmetic, knowledge, logic, instructions, and extraction. Fast enough for slow local models.",
    tasks: [
      {
        name: "Change from a bill",
        category: "math",
        prompt:
          "A bakery sells muffins for $3 each. Tom buys 7 muffins and pays with a $50 bill. How much change does he get, in dollars?" +
          NUMERIC_SUFFIX,
        scoring: "numeric",
        expected: "29",
      },
      {
        name: "Average speed",
        category: "math",
        prompt:
          "A train travels 180 km in 2.5 hours. What is its average speed in km/h?" +
          NUMERIC_SUFFIX,
        scoring: "numeric",
        expected: "72",
      },
      {
        name: "Most moons",
        category: "knowledge",
        prompt:
          "Which of these planets has the most known moons? A) Earth B) Mars C) Saturn D) Mercury." +
          MCQ_SUFFIX,
        scoring: "mcq",
        expected: "C",
      },
      {
        name: "Chemical symbol",
        category: "knowledge",
        prompt: "What is the chemical symbol for gold? A) Ag B) Au C) Gd D) Go." + MCQ_SUFFIX,
        scoring: "mcq",
        expected: "B",
      },
      {
        name: "Verbatim echo",
        category: "instructions",
        prompt: "Respond with exactly the following text and nothing else: LOOM BENCHMARK OK",
        scoring: "exact",
        expected: "LOOM BENCHMARK OK",
      },
      {
        name: "Countdown list",
        category: "instructions",
        prompt: "List the numbers from 5 down to 1, separated by commas, with no other text.",
        scoring: "regex",
        expected: "^\\W*5\\s*,\\s*4\\s*,\\s*3\\s*,\\s*2\\s*,\\s*1\\W*$",
      },
      {
        name: "Simple JSON object",
        category: "json",
        prompt:
          "Return a JSON object with the key 'name' set to 'Loom' and the key 'year' set to the number 2026. Return only the JSON.",
        scoring: "json",
        expected: '{"name":"Loom","year":2026}',
      },
      {
        name: "Syllogism",
        category: "logic",
        prompt:
          "All bloops are razzies. All razzies are lazzies. Are all bloops definitely lazzies? A) Yes B) No C) Cannot be determined." +
          MCQ_SUFFIX,
        scoring: "mcq",
        expected: "A",
      },
      {
        name: "Nested counting",
        category: "logic",
        prompt:
          "You have 3 boxes. Each box contains 4 bags, and each bag holds 5 marbles. How many marbles are there in total?" +
          NUMERIC_SUFFIX,
        scoring: "numeric",
        expected: "60",
      },
      {
        name: "Email extraction",
        category: "extraction",
        prompt:
          "Extract the email address from this text and reply with only the email address: 'Contact our support team at help@loomapp.dev for assistance.'",
        scoring: "contains",
        expected: "help@loomapp.dev",
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
      "10 GSM8K-style word problems and logic puzzles with exact numeric or multiple-choice answers.",
    tasks: [
      {
        name: "Sticker ratio",
        category: "math",
        prompt:
          "Sarah has 3 times as many stickers as Tom. Together they have 48 stickers. How many stickers does Sarah have?" +
          NUMERIC_SUFFIX,
        scoring: "numeric",
        expected: "36",
      },
      {
        name: "Reverse discount",
        category: "math",
        prompt:
          "A shirt costs $25 after a 20% discount. What was the original price in dollars?" +
          NUMERIC_SUFFIX,
        scoring: "numeric",
        expected: "31.25",
      },
      {
        name: "Even sum",
        category: "math",
        prompt:
          "What is the sum of all even numbers from 2 to 20, inclusive?" + NUMERIC_SUFFIX,
        scoring: "numeric",
        expected: "110",
      },
      {
        name: "Rectangle area",
        category: "math",
        prompt:
          "A rectangle's length is twice its width. Its perimeter is 36 cm. What is its area in square centimeters?" +
          NUMERIC_SUFFIX,
        scoring: "numeric",
        expected: "72",
      },
      {
        name: "Reading schedule",
        category: "math",
        prompt:
          "Lena reads 15 pages per day for 6 days, then 20 pages per day for 3 days. How many pages does she read in total?" +
          NUMERIC_SUFFIX,
        scoring: "numeric",
        expected: "150",
      },
      {
        name: "Machines & widgets",
        category: "logic",
        prompt:
          "If 5 machines make 5 widgets in 5 minutes, how many minutes would 100 machines take to make 100 widgets?" +
          NUMERIC_SUFFIX,
        scoring: "numeric",
        expected: "5",
      },
      {
        name: "Height ordering",
        category: "logic",
        prompt:
          "Anna is taller than Ben. Ben is taller than Carl. Dave is shorter than Carl. Who is the second tallest? A) Anna B) Ben C) Carl D) Dave." +
          MCQ_SUFFIX,
        scoring: "mcq",
        expected: "B",
      },
      {
        name: "Number sequence",
        category: "logic",
        prompt:
          "Which number comes next in the sequence 2, 6, 12, 20, 30, …? A) 40 B) 42 C) 44 D) 36." +
          MCQ_SUFFIX,
        scoring: "mcq",
        expected: "B",
      },
      {
        name: "Clock difference",
        category: "math",
        prompt:
          "A clock shows 3:15. In how many minutes will it show 4:05?" + NUMERIC_SUFFIX,
        scoring: "numeric",
        expected: "50",
      },
      {
        name: "Ticket algebra",
        category: "math",
        prompt:
          "Tickets cost $8 for adults and $5 for children. A group of 4 adults and some children paid $52 in total. How many children were in the group?" +
          NUMERIC_SUFFIX,
        scoring: "numeric",
        expected: "4",
      },
    ],
  },
  {
    id: "builtin-knowledge",
    name: "General Knowledge",
    description:
      "12 MMLU-style multiple-choice questions across science, history, geography, arts, and computing.",
    tasks: [
      mcq("Insulin organ", "Which organ produces insulin? A) Liver B) Pancreas C) Kidney D) Spleen.", "B"),
      mcq("WWII end", "In which year did World War II end? A) 1943 B) 1944 C) 1945 D) 1946.", "C"),
      mcq("Australia capital", "What is the capital of Australia? A) Sydney B) Melbourne C) Canberra D) Perth.", "C"),
      mcq(
        "Atmosphere gas",
        "Which gas makes up the largest share of Earth's atmosphere? A) Oxygen B) Carbon dioxide C) Nitrogen D) Argon.",
        "C",
      ),
      mcq(
        "Solitude author",
        "Who wrote 'One Hundred Years of Solitude'? A) Jorge Luis Borges B) Gabriel García Márquez C) Pablo Neruda D) Mario Vargas Llosa.",
        "B",
      ),
      mcq(
        "HTTP meaning",
        "In computing, what does HTTP stand for? A) HyperText Transfer Protocol B) High Throughput Transfer Protocol C) HyperText Transmission Process D) Host Transfer Text Protocol.",
        "A",
      ),
      mcq("Largest ocean", "Which is the largest ocean on Earth? A) Atlantic B) Indian C) Arctic D) Pacific.", "D"),
      mcq(
        "Speed of light",
        "The speed of light in a vacuum is approximately: A) 300,000 km/s B) 150,000 km/s C) 1,000,000 km/s D) 30,000 km/s.",
        "A",
      ),
      mcq("Atomic number 1", "Which element has atomic number 1? A) Helium B) Hydrogen C) Lithium D) Oxygen.", "B"),
      mcq(
        "Everest border",
        "Mount Everest lies on the border between Nepal and which other country? A) India B) Bhutan C) China D) Pakistan.",
        "C",
      ),
      mcq(
        "Sistine Chapel",
        "Which artist painted the ceiling of the Sistine Chapel? A) Leonardo da Vinci B) Raphael C) Michelangelo D) Donatello.",
        "C",
      ),
      mcq(
        "FIFO structure",
        "Which data structure processes elements in first-in, first-out (FIFO) order? A) Stack B) Queue C) Tree D) Graph.",
        "B",
      ),
    ],
  },
  {
    id: "builtin-instructions",
    name: "Instruction Following",
    description:
      "8 IFEval-style tasks with programmatically checkable constraints: exact text, formats, counts, and JSON shapes.",
    tasks: [
      {
        name: "Exact phrase",
        category: "instructions",
        prompt: "Respond with exactly this text and nothing else: The quick brown fox",
        scoring: "exact",
        expected: "The quick brown fox",
      },
      {
        name: "Uppercase transform",
        category: "instructions",
        prompt:
          "Write the sentence 'i love benchmarks' in all uppercase letters, with no other text.",
        scoring: "exact",
        expected: "I LOVE BENCHMARKS",
      },
      {
        name: "Three fruits",
        category: "instructions",
        prompt:
          "Name exactly three fruits as a comma-separated list on a single line, with no other text.",
        scoring: "regex",
        expected: "^\\s*[A-Za-z][A-Za-z ]*,\\s*[A-Za-z][A-Za-z ]*,\\s*[A-Za-z][A-Za-z ]*\\s*$",
      },
      {
        name: "Prime array",
        category: "json",
        prompt: "Return only a JSON array containing the first 5 prime numbers in ascending order.",
        scoring: "json",
        expected: "[2,3,5,7,11]",
      },
      {
        name: "One-word answer",
        category: "instructions",
        prompt: "Answer with a single word: what color is a ripe banana?",
        scoring: "regex",
        expected: "^\\W*yellow\\W*$",
      },
      {
        name: "Word reversal",
        category: "instructions",
        prompt: "Reverse the word 'benchmark' and reply with only the reversed word.",
        scoring: "contains",
        expected: "kramhcneb",
      },
      {
        name: "Repeat four times",
        category: "instructions",
        prompt:
          "Reply with the word 'loom' exactly four times, separated by single spaces, with no other text.",
        scoring: "regex",
        expected: "^\\W*loom loom loom loom\\W*$",
      },
      {
        name: "JSON with array",
        category: "json",
        prompt:
          "Return only a JSON object with a key 'languages' whose value is the array [\"Python\", \"Rust\"] exactly.",
        scoring: "json",
        expected: '{"languages":["Python","Rust"]}',
      },
    ],
  },
];
