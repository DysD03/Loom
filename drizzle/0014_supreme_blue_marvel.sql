CREATE TABLE `goal_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`problem_spec` text DEFAULT '' NOT NULL,
	`start_state` text DEFAULT '' NOT NULL,
	`goal_state` text DEFAULT '' NOT NULL,
	`forward_nodes` text,
	`backward_nodes` text,
	`reconcile` text,
	`bridge` text,
	`max_rounds` integer DEFAULT 6 NOT NULL,
	`status` text DEFAULT 'planning' NOT NULL,
	`error` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `goal_runs_conversation_idx` ON `goal_runs` (`conversation_id`,`created_at`);