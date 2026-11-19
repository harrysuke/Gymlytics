CREATE TABLE `academy_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`academy_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`status` text DEFAULT 'trialing' NOT NULL,
	`trial_ends_at` text,
	`current_period_end` text,
	`provider` text,
	`provider_subscription_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`academy_id`) REFERENCES `academies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`plan_id`) REFERENCES `saas_plans`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `academy_subscriptions_academy_id_unique` ON `academy_subscriptions` (`academy_id`);--> statement-breakpoint
CREATE INDEX `academy_subscriptions_status_idx` ON `academy_subscriptions` (`status`);--> statement-breakpoint
CREATE TABLE `affiliations` (
	`id` text PRIMARY KEY NOT NULL,
	`academy_id` text NOT NULL,
	`name` text NOT NULL,
	`contact_email` text,
	`verification_code` text NOT NULL,
	`verified_at` text,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`academy_id`) REFERENCES `academies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `affiliations_verification_code_unique` ON `affiliations` (`verification_code`);--> statement-breakpoint
CREATE INDEX `affiliations_academy_idx` ON `affiliations` (`academy_id`);--> statement-breakpoint
CREATE TABLE `class_recaps` (
	`id` text PRIMARY KEY NOT NULL,
	`academy_id` text NOT NULL,
	`class_id` text NOT NULL,
	`coach_id` text,
	`summary` text NOT NULL,
	`video_url` text,
	`techniques` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`academy_id`) REFERENCES `academies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`coach_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `class_recaps_class_uq` ON `class_recaps` (`class_id`);--> statement-breakpoint
CREATE TABLE `cross_training_passes` (
	`id` text PRIMARY KEY NOT NULL,
	`academy_id` text NOT NULL,
	`user_id` text NOT NULL,
	`affiliation_id` text,
	`qr_token` text NOT NULL,
	`pass_date` text NOT NULL,
	`status` text DEFAULT 'requested' NOT NULL,
	`waiver_id` text,
	`checked_in_at` text,
	`notes` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`academy_id`) REFERENCES `academies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`affiliation_id`) REFERENCES `affiliations`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cross_training_passes_qr_token_unique` ON `cross_training_passes` (`qr_token`);--> statement-breakpoint
CREATE INDEX `cross_training_passes_academy_date_idx` ON `cross_training_passes` (`academy_id`,`pass_date`);--> statement-breakpoint
CREATE INDEX `cross_training_passes_status_idx` ON `cross_training_passes` (`academy_id`,`status`);--> statement-breakpoint
CREATE TABLE `curriculum_videos` (
	`id` text PRIMARY KEY NOT NULL,
	`academy_id` text NOT NULL,
	`program_id` text,
	`belt_slug` text,
	`title` text NOT NULL,
	`description` text,
	`url` text NOT NULL,
	`thumbnail_url` text,
	`duration_seconds` integer DEFAULT 0 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`published` integer DEFAULT true NOT NULL,
	`created_by_user_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`academy_id`) REFERENCES `academies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`program_id`) REFERENCES `programs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `curriculum_videos_academy_belt_idx` ON `curriculum_videos` (`academy_id`,`belt_slug`);--> statement-breakpoint
CREATE INDEX `curriculum_videos_academy_program_idx` ON `curriculum_videos` (`academy_id`,`program_id`);--> statement-breakpoint
CREATE TABLE `import_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`academy_id` text NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`file_name` text,
	`total_rows` integer DEFAULT 0 NOT NULL,
	`imported_rows` integer DEFAULT 0 NOT NULL,
	`errors` text NOT NULL,
	`created_by_user_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`academy_id`) REFERENCES `academies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `import_jobs_academy_created_idx` ON `import_jobs` (`academy_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `onboarding_progress` (
	`id` text PRIMARY KEY NOT NULL,
	`academy_id` text NOT NULL,
	`current_step` text DEFAULT 'profile' NOT NULL,
	`completed_steps` text NOT NULL,
	`completed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`academy_id`) REFERENCES `academies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `onboarding_progress_academy_id_unique` ON `onboarding_progress` (`academy_id`);--> statement-breakpoint
CREATE TABLE `saas_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`price_cents` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'MYR' NOT NULL,
	`features` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_public` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `saas_plans_slug_unique` ON `saas_plans` (`slug`);--> statement-breakpoint
CREATE INDEX `saas_plans_sort_idx` ON `saas_plans` (`sort_order`);--> statement-breakpoint
CREATE TABLE `widgets` (
	`id` text PRIMARY KEY NOT NULL,
	`academy_id` text NOT NULL,
	`kind` text NOT NULL,
	`token` text NOT NULL,
	`label` text NOT NULL,
	`config` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`academy_id`) REFERENCES `academies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `widgets_token_unique` ON `widgets` (`token`);--> statement-breakpoint
CREATE INDEX `widgets_academy_kind_idx` ON `widgets` (`academy_id`,`kind`);--> statement-breakpoint
ALTER TABLE `academies` ADD `parent_academy_id` text REFERENCES academies(id);--> statement-breakpoint
CREATE INDEX `academies_parent_idx` ON `academies` (`parent_academy_id`);