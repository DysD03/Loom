ALTER TABLE `app_settings` ADD `token_pricing` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `benchmark_runs` ADD `temperature` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `benchmark_runs` ADD `cold_starts` text DEFAULT '{}' NOT NULL;