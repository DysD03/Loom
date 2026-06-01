ALTER TABLE `conversations` ADD `agent_max_steps` integer;--> statement-breakpoint
ALTER TABLE `conversations` ADD `agent_tools` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `parts` text;