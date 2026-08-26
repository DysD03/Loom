ALTER TABLE `app_settings` ADD `ollama_base_url` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `ollama_api_key` text DEFAULT 'ollama' NOT NULL;