CREATE TABLE `research_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`question` text NOT NULL,
	`plan` text,
	`sources` text,
	`report` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'planning' NOT NULL,
	`error` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `research_reports_conversation_idx` ON `research_reports` (`conversation_id`,`created_at`);