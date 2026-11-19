CREATE TABLE `incidents` (
	`id` text PRIMARY KEY NOT NULL,
	`academy_id` text NOT NULL,
	`user_id` text,
	`program_id` text,
	`class_id` text,
	`occurred_at` text NOT NULL,
	`location` text,
	`type` text DEFAULT 'injury' NOT NULL,
	`severity` text DEFAULT 'minor' NOT NULL,
	`description` text NOT NULL,
	`action_taken` text,
	`witness_name` text,
	`reported_by_user_id` text,
	`follow_up_required` integer DEFAULT false NOT NULL,
	`follow_up_completed_at` text,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`academy_id`) REFERENCES `academies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`program_id`) REFERENCES `programs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`reported_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `incidents_academy_date_idx` ON `incidents` (`academy_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `incidents_academy_status_idx` ON `incidents` (`academy_id`,`status`);--> statement-breakpoint
CREATE TABLE `leads` (
	`id` text PRIMARY KEY NOT NULL,
	`academy_id` text NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`email` text,
	`phone` text,
	`source` text DEFAULT 'walk_in' NOT NULL,
	`referred_by_user_id` text,
	`status` text DEFAULT 'new' NOT NULL,
	`trial_attended_at` text,
	`converted_at` text,
	`converted_membership_id` text,
	`last_contact_at` text,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`academy_id`) REFERENCES `academies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`referred_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `leads_academy_status_idx` ON `leads` (`academy_id`,`status`);--> statement-breakpoint
CREATE INDEX `leads_academy_source_idx` ON `leads` (`academy_id`,`source`);--> statement-breakpoint
CREATE UNIQUE INDEX `leads_academy_email_idx` ON `leads` (`academy_id`,`email`);--> statement-breakpoint
ALTER TABLE `users` ADD `acquisition_source` text;--> statement-breakpoint
ALTER TABLE `users` ADD `referred_by_user_id` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `memberships` ADD `cancellation_reason` text;--> statement-breakpoint
ALTER TABLE `memberships` ADD `cancellation_note` text;