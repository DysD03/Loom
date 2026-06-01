CREATE TABLE `app_settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`llm_base_url` text DEFAULT 'http://localhost:1234/v1' NOT NULL,
	`llm_api_key` text DEFAULT 'lm-studio' NOT NULL,
	`llm_model` text DEFAULT '' NOT NULL,
	`embeddings_model` text DEFAULT '' NOT NULL,
	`searxng_url` text DEFAULT 'http://localhost:8080' NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);
