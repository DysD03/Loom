ALTER TABLE `app_settings` ADD `compute_cost_per_hour` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `benchmark_results` ADD `ttft_ms` integer;--> statement-breakpoint
ALTER TABLE `benchmark_results` ADD `prompt_tokens` integer;--> statement-breakpoint
ALTER TABLE `benchmark_results` ADD `prompt_tokens_per_second` real;--> statement-breakpoint
ALTER TABLE `benchmark_runs` ADD `started_at` text;--> statement-breakpoint
ALTER TABLE `benchmark_runs` ADD `finished_at` text;--> statement-breakpoint
ALTER TABLE `benchmark_runs` ADD `cost_per_hour` real;