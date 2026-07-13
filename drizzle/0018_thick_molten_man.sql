CREATE TABLE `benchmark_results` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`model` text NOT NULL,
	`task_index` integer NOT NULL,
	`output` text DEFAULT '' NOT NULL,
	`score` real DEFAULT 0 NOT NULL,
	`passed` integer DEFAULT false NOT NULL,
	`latency_ms` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer,
	`tokens_per_second` real,
	`error` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `benchmark_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `benchmark_results_run_idx` ON `benchmark_results` (`run_id`,`model`,`task_index`);--> statement-breakpoint
CREATE TABLE `benchmark_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text DEFAULT 'Benchmark run' NOT NULL,
	`suite_id` text,
	`suite_name` text DEFAULT '' NOT NULL,
	`models` text DEFAULT '[]' NOT NULL,
	`tasks` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`error` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`suite_id`) REFERENCES `benchmark_suites`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `benchmark_suites` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`builtin` integer DEFAULT false NOT NULL,
	`tasks` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);
