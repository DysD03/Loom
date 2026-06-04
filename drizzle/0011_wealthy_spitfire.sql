CREATE TABLE `editor_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text DEFAULT 'Untitled document' NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`document_id` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
ALTER TABLE `documents` ADD `source` text DEFAULT 'upload' NOT NULL;