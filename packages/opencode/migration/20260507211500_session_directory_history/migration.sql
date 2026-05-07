CREATE TABLE `session_directory_history` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`from_directory` text,
	`to_directory` text NOT NULL,
	`from_project_id` text,
	`to_project_id` text NOT NULL,
	`actor` text NOT NULL,
	`reason` text,
	`time_created` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `session_directory_history_session_idx` ON `session_directory_history` (`session_id`,`time_created`);
