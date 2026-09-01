ALTER TABLE `benchmark_results` ADD `repeat_index` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `benchmark_runs` ADD `repeats` integer DEFAULT 1 NOT NULL;