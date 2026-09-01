ALTER TABLE `app_settings` ADD `baseline_run_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `benchmark_results` ADD `temperature` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `benchmark_runs` ADD `temperatures` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `benchmark_runs` ADD `concurrency` text DEFAULT '{}' NOT NULL;