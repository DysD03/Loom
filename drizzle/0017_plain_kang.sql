CREATE TABLE `dashboards` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text DEFAULT 'Untitled dashboard' NOT NULL,
	`source_markdown` text DEFAULT '' NOT NULL,
	`source_name` text DEFAULT '' NOT NULL,
	`spec` text,
	`generated_by` text DEFAULT 'fallback' NOT NULL,
	`model` text,
	`error` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);
