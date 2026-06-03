CREATE TABLE `canvases` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text DEFAULT 'Untitled canvas' NOT NULL,
	`nodes` text DEFAULT '[]' NOT NULL,
	`edges` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);
