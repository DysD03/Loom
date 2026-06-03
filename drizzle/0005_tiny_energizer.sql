CREATE TABLE `personas` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`system_prompt` text DEFAULT '' NOT NULL,
	`builtin` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `conversations` ADD `agent_persona_id` text REFERENCES personas(id);--> statement-breakpoint
ALTER TABLE `conversations` ADD `agent_reasoning` text;