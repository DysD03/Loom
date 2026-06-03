CREATE TABLE `document_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`chunk_index` integer DEFAULT 0 NOT NULL,
	`content` text NOT NULL,
	`embedding` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `document_chunks_document_idx` ON `document_chunks` (`document_id`,`chunk_index`);--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`filename` text DEFAULT '' NOT NULL,
	`kind` text DEFAULT 'text' NOT NULL,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`char_count` integer DEFAULT 0 NOT NULL,
	`chunk_count` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'processing' NOT NULL,
	`error` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);
