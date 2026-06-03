ALTER TABLE `app_settings` ADD `anthropic_api_key` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `openai_api_key` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `google_api_key` text DEFAULT '' NOT NULL;