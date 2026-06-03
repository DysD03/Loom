CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text DEFAULT 'Workspace' NOT NULL,
	`path` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);
