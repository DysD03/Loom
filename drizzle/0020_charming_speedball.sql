CREATE TABLE `email_summaries` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`last_message_id` text DEFAULT '' NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`model` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `email_summaries_thread_idx` ON `email_summaries` (`thread_id`,`last_message_id`);--> statement-breakpoint
CREATE TABLE `gmail_account` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`client_id` text DEFAULT '' NOT NULL,
	`client_secret` text DEFAULT '' NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`refresh_token` text DEFAULT '' NOT NULL,
	`access_token` text DEFAULT '' NOT NULL,
	`access_token_expires_at` integer DEFAULT 0 NOT NULL,
	`scope` text DEFAULT '' NOT NULL,
	`oauth_state` text,
	`connected_at` text,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);
