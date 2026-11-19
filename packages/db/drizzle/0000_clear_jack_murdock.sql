CREATE TABLE `academies` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`timezone` text DEFAULT 'Asia/Kuala_Lumpur' NOT NULL,
	`currency` text DEFAULT 'MYR' NOT NULL,
	`country_code` text DEFAULT 'MY' NOT NULL,
	`phone` text,
	`email` text,
	`address_line1` text,
	`address_line2` text,
	`city` text,
	`state` text,
	`postal_code` text,
	`logo_url` text,
	`settings` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `academies_slug_unique` ON `academies` (`slug`);--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`academy_id` text NOT NULL,
	`user_id` text NOT NULL,
	`refresh_token_hash` text NOT NULL,
	`user_agent` text,
	`ip_address` text,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`last_used_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`academy_id`) REFERENCES `academies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_sessions_refresh_token_hash_unique` ON `auth_sessions` (`refresh_token_hash`);--> statement-breakpoint
CREATE INDEX `auth_sessions_user_idx` ON `auth_sessions` (`user_id`,`revoked_at`);--> statement-breakpoint
CREATE INDEX `auth_sessions_expiry_idx` ON `auth_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `family_links` (
	`id` text PRIMARY KEY NOT NULL,
	`academy_id` text NOT NULL,
	`guardian_id` text NOT NULL,
	`dependent_id` text NOT NULL,
	`relationship` text DEFAULT 'guardian' NOT NULL,
	`is_primary_billing` integer DEFAULT false NOT NULL,
	`can_sign_waivers` integer DEFAULT true NOT NULL,
	`can_view_progress` integer DEFAULT true NOT NULL,
	`can_book_classes` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`academy_id`) REFERENCES `academies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`guardian_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`dependent_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `family_links_pair_uq` ON `family_links` (`guardian_id`,`dependent_id`);--> statement-breakpoint
CREATE INDEX `family_links_dependent_idx` ON `family_links` (`dependent_id`);--> statement-breakpoint
CREATE INDEX `family_links_academy_idx` ON `family_links` (`academy_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`academy_id` text NOT NULL,
	`role` text DEFAULT 'student' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`preferred_name` text,
	`email` text,
	`phone` text,
	`password_hash` text,
	`pin_hash` text,
	`qr_token` text,
	`date_of_birth` text,
	`gender` text,
	`avatar_url` text,
	`address_line1` text,
	`city` text,
	`state` text,
	`postal_code` text,
	`emergency_contact_name` text,
	`emergency_contact_phone` text,
	`medical_notes` text,
	`email_verified_at` text,
	`last_login_at` text,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`academy_id`) REFERENCES `academies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_qr_token_unique` ON `users` (`qr_token`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_academy_email_uq` ON `users` (`academy_id`,`email`);--> statement-breakpoint
CREATE INDEX `users_academy_status_idx` ON `users` (`academy_id`,`status`);--> statement-breakpoint
CREATE INDEX `users_academy_name_idx` ON `users` (`academy_id`,`last_name`,`first_name`);--> statement-breakpoint
CREATE TABLE `belt_ranks` (
	`id` text PRIMARY KEY NOT NULL,
	`academy_id` text NOT NULL,
	`program_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`system` text DEFAULT 'custom' NOT NULL,
	`order_index` integer NOT NULL,
	`max_stripes` integer DEFAULT 4 NOT NULL,
	`min_months_in_rank` integer DEFAULT 0 NOT NULL,
	`min_classes_in_rank` integer DEFAULT 0 NOT NULL,
	`min_mat_hours` integer DEFAULT 0 NOT NULL,
	`color_hex` text DEFAULT '#FFFFFF',
	`stripe_color_hex` text DEFAULT '#111827',
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`academy_id`) REFERENCES `academies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`program_id`) REFERENCES `programs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `belt_ranks_program_slug_uq` ON `belt_ranks` (`program_id`,`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `belt_ranks_program_order_uq` ON `belt_ranks` (`program_id`,`order_index`);--> statement-breakpoint
CREATE TABLE `curriculum_requirements` (
	`id` text PRIMARY KEY NOT NULL,
	`academy_id` text NOT NULL,
	`belt_rank_id` text NOT NULL,
	`technique_id` text NOT NULL,
	`required_stripe_level` integer DEFAULT 0 NOT NULL,
	`is_required` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`academy_id`) REFERENCES `academies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`belt_rank_id`) REFERENCES `belt_ranks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`technique_id`) REFERENCES `curriculum_techniques`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `curriculum_req_uq` ON `curriculum_requirements` (`belt_rank_id`,`technique_id`,`required_stripe_level`);--> statement-breakpoint
CREATE TABLE `curriculum_techniques` (
	`id` text PRIMARY KEY NOT NULL,
	`academy_id` text NOT NULL,
	`program_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`category` text NOT NULL,
	`description` text,
	`video_url` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`academy_id`) REFERENCES `academies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`program_id`) REFERENCES `programs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `curriculum_program_slug_uq` ON `curriculum_techniques` (`program_id`,`slug`);--> statement-breakpoint
CREATE TABLE `programs` (
	`id` text PRIMARY KEY NOT NULL,
	`academy_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`discipline` text NOT NULL,
	`description` text,
	`age_group` text DEFAULT 'all' NOT NULL,
	`color_hex` text DEFAULT '#1D4ED8',
	`icon_key` text,
	`default_capacity` integer DEFAULT 20 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`academy_id`) REFERENCES `academies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `programs_academy_slug_uq` ON `programs` (`academy_id`,`slug`);--> statement-breakpoint
CREATE INDEX `programs_academy_active_idx` ON `programs` (`academy_id`,`is_active`);--> statement-breakpoint
CREATE TABLE `bookings` (
	`id` text PRIMARY KEY NOT NULL,
	`academy_id` text NOT NULL,
	`class_id` text NOT NULL,
	`user_id` text NOT NULL,
	`status` text DEFAULT 'booked' NOT NULL,
	`source` text DEFAULT 'web' NOT NULL,
	`booked_at` text NOT NULL,
	`cancelled_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`academy_id`) REFERENCES `academies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bookings_active_uq` ON `bookings` (`class_id`,`user_id`) WHERE status <> 'cancelled';--> statement-breakpoint
CREATE INDEX `bookings_user_idx` ON `bookings` (`user_id`,`booked_at`);--> statement-breakpoint
CREATE INDEX `bookings_class_status_idx` ON `bookings` (`class_id`,`status`);--> statement-breakpoint
CREATE TABLE `class_techniques` (
	`id` text PRIMARY KEY NOT NULL,
	`academy_id` text NOT NULL,
	`class_id` text NOT NULL,
	`technique_id` text NOT NULL,
	`taught_by` text NOT NULL,
	`notes` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`academy_id`) REFERENCES `academies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`technique_id`) REFERENCES `curriculum_techniques`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `class_technique_uq` ON `class_techniques` (`class_id`,`technique_id`);--> statement-breakpoint
CREATE TABLE `class_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`academy_id` text NOT NULL,
	`program_id` text NOT NULL,
	`coach_id` text,
	`title` text NOT NULL,
	`day_of_week` integer NOT NULL,
	`start_time` text NOT NULL,
	`duration_minutes` integer DEFAULT 90 NOT NULL,
	`capacity` integer DEFAULT 20 NOT NULL,
	`location` text,
	`recurrence_rule` text DEFAULT 'FREQ=WEEKLY;INTERVAL=1' NOT NULL,
	`effective_from` text,
	`effective_until` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`academy_id`) REFERENCES `academies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`program_id`) REFERENCES `programs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`coach_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `class_templates_academy_idx` ON `class_templates` (`academy_id`,`day_of_week`);--> statement-breakpoint
CREATE TABLE `classes` (
	`id` text PRIMARY KEY NOT NULL,
	`academy_id` text NOT NULL,
	`program_id` text NOT NULL,
	`template_id` text,
	`coach_id` text,
	`substitute_coach_id` text,
	`title` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`capacity` integer DEFAULT 20 NOT NULL,
	`booked_count` integer DEFAULT 0 NOT NULL,
	`checked_in_count` integer DEFAULT 0 NOT NULL,
	`location` text,
	`notes` text,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`academy_id`) REFERENCES `academies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`program_id`) REFERENCES `programs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`template_id`) REFERENCES `class_templates`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`coach_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`substitute_coach_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `classes_academy_starts_idx` ON `classes` (`academy_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `classes_program_starts_idx` ON `classes` (`program_id`,`starts_at`);--> statement-breakpoint
CREATE TABLE `applied_mutations` (
	`mutation_id` text PRIMARY KEY NOT NULL,
	`academy_id` text NOT NULL,
	`device_id` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`result_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `attendance_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`academy_id` text NOT NULL,
	`class_id` text NOT NULL,
	`user_id` text NOT NULL,
	`booking_id` text,
	`checked_in_at` text NOT NULL,
	`checked_out_at` text,
	`method` text NOT NULL,
	`status` text DEFAULT 'checked_in' NOT NULL,
	`kiosk_id` text,
	`drop_in_transaction_id` text,
	`notes` text,
	`version` integer DEFAULT 1 NOT NULL,
	`hlc` text NOT NULL,
	`origin_device_id` text NOT NULL,
	`sync_status` text DEFAULT 'local' NOT NULL,
	`mutation_id` text NOT NULL,
	`synced_at` text,
	`conflict_of_id` text,
	`last_error` text,
	`deleted_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`academy_id`) REFERENCES `academies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`drop_in_transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attendance_mutation_uq` ON `attendance_logs` (`mutation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `attendance_once_per_class_uq` ON `attendance_logs` (`class_id`,`user_id`) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX `attendance_sync_queue_idx` ON `attendance_logs` (`academy_id`,`sync_status`);--> statement-breakpoint
CREATE INDEX `attendance_hlc_idx` ON `attendance_logs` (`hlc`);--> statement-breakpoint
CREATE INDEX `attendance_user_date_idx` ON `attendance_logs` (`user_id`,`checked_in_at`);--> statement-breakpoint
CREATE TABLE `local_sync_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`academy_id` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`operation` text NOT NULL,
	`payload` text NOT NULL,
	`hlc` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`origin_device_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`academy_id`) REFERENCES `academies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sync_changes_pull_idx` ON `sync_changes` (`academy_id`,`hlc`);--> statement-breakpoint
CREATE INDEX `sync_changes_entity_idx` ON `sync_changes` (`entity`,`entity_id`);--> statement-breakpoint
CREATE TABLE `sync_cursors` (
	`id` text PRIMARY KEY NOT NULL,
	`academy_id` text NOT NULL,
	`device_id` text NOT NULL,
	`last_server_hlc` text DEFAULT '1970-01-01T00:00:00.000Z-0000' NOT NULL,
	`last_pulled_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`academy_id`) REFERENCES `academies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sync_cursor_uq` ON `sync_cursors` (`academy_id`,`device_id`);--> statement-breakpoint
CREATE TABLE `sync_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`academy_id` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`operation` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` text NOT NULL,
	`last_error` text,
	`hlc` text NOT NULL,
	`origin_device_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_at` text NOT NULL,
	`acked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sync_outbox_idempotency_key_unique` ON `sync_outbox` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `outbox_status_next_idx` ON `sync_outbox` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `outbox_entity_idx` ON `sync_outbox` (`entity`,`entity_id`);--> statement-breakpoint
CREATE TABLE `promotions` (
	`id` text PRIMARY KEY NOT NULL,
	`academy_id` text NOT NULL,
	`user_id` text NOT NULL,
	`program_id` text NOT NULL,
	`from_belt_rank_id` text,
	`to_belt_rank_id` text NOT NULL,
	`from_stripes` integer DEFAULT 0 NOT NULL,
	`to_stripes` integer DEFAULT 0 NOT NULL,
	`promoted_at` text NOT NULL,
	`effective_at` text,
	`promoted_by` text,
	`classes_since_promotion` integer DEFAULT 0 NOT NULL,
	`mat_hours_since_promotion` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`certificate_url` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`academy_id`) REFERENCES `academies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`program_id`) REFERENCES `programs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`from_belt_rank_id`) REFERENCES `belt_ranks`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`to_belt_rank_id`) REFERENCES `belt_ranks`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`promoted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `promotions_user_program_idx` ON `promotions` (`user_id`,`program_id`,`promoted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `promotions_idempotency_uq` ON `promotions` (`user_id`,`program_id`,`to_belt_rank_id`,`to_stripes`,`promoted_at`);--> statement-breakpoint
CREATE TABLE `waiver_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`academy_id` text NOT NULL,
	`waiver_type` text NOT NULL,
	`version` integer NOT NULL,
	`title` text NOT NULL,
	`body_markdown` text NOT NULL,
	`document_hash` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`academy_id`) REFERENCES `academies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `waiver_templates_version_uq` ON `waiver_templates` (`academy_id`,`waiver_type`,`version`);--> statement-breakpoint
CREATE INDEX `waiver_templates_active_idx` ON `waiver_templates` (`academy_id`,`waiver_type`,`is_active`);--> statement-breakpoint
CREATE TABLE `waivers` (
	`id` text PRIMARY KEY NOT NULL,
	`academy_id` text NOT NULL,
	`user_id` text NOT NULL,
	`program_id` text,
	`waiver_type` text NOT NULL,
	`document_version` integer NOT NULL,
	`document_title` text NOT NULL,
	`document_hash` text NOT NULL,
	`signature_data` text NOT NULL,
	`signature_format` text DEFAULT 'svg_path' NOT NULL,
	`signer_name` text NOT NULL,
	`signer_ip` text NOT NULL,
	`user_agent` text,
	`signed_at` text NOT NULL,
	`date_of_birth_snapshot` text,
	`guardian_user_id` text,
	`status` text DEFAULT 'signed' NOT NULL,
	`expires_at` text,
	`pdf_url` text,
	`hlc` text NOT NULL,
	`mutation_id` text NOT NULL,
	`sync_status` text DEFAULT 'local' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`academy_id`) REFERENCES `academies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`program_id`) REFERENCES `programs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`guardian_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `waivers_version_uq` ON `waivers` (`user_id`,`waiver_type`,`document_version`);--> statement-breakpoint
CREATE UNIQUE INDEX `waivers_mutation_uq` ON `waivers` (`mutation_id`);--> statement-breakpoint
CREATE INDEX `waivers_user_idx` ON `waivers` (`user_id`,`status`);--> statement-breakpoint
CREATE TABLE `membership_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`academy_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`plan_type` text NOT NULL,
	`billing_interval` text DEFAULT 'monthly' NOT NULL,
	`price_cents` integer NOT NULL,
	`currency` text DEFAULT 'MYR' NOT NULL,
	`classes_per_week` integer,
	`class_pack_count` integer,
	`family_discount_percent` integer DEFAULT 0 NOT NULL,
	`max_dependents` integer DEFAULT 0 NOT NULL,
	`freeze_allowed` integer DEFAULT true NOT NULL,
	`freeze_max_days_per_year` integer DEFAULT 30 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`academy_id`) REFERENCES `academies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `membership_plans_academy_idx` ON `membership_plans` (`academy_id`,`is_active`);--> statement-breakpoint
CREATE TABLE `memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`academy_id` text NOT NULL,
	`user_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`status` text DEFAULT 'pending_payment' NOT NULL,
	`current_period_start` text NOT NULL,
	`current_period_end` text NOT NULL,
	`classes_used_in_period` integer DEFAULT 0 NOT NULL,
	`frozen_at` text,
	`freeze_until` text,
	`total_frozen_days` integer DEFAULT 0 NOT NULL,
	`provider` text DEFAULT 'manual' NOT NULL,
	`provider_customer_id` text,
	`provider_subscription_id` text,
	`default_payment_method_id` text,
	`next_billing_at` text,
	`cancelled_at` text,
	`cancel_at_period_end` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`academy_id`) REFERENCES `academies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`plan_id`) REFERENCES `membership_plans`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `memberships_user_idx` ON `memberships` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `memberships_renewal_idx` ON `memberships` (`status`,`next_billing_at`);--> statement-breakpoint
CREATE TABLE `payment_methods` (
	`id` text PRIMARY KEY NOT NULL,
	`academy_id` text NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_customer_id` text NOT NULL,
	`provider_payment_method_id` text NOT NULL,
	`brand` text,
	`last_4` text,
	`expiry_month` integer,
	`expiry_year` integer,
	`is_default` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`academy_id`) REFERENCES `academies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `payment_methods_user_idx` ON `payment_methods` (`user_id`,`status`);--> statement-breakpoint
CREATE TABLE `payment_retries` (
	`id` text PRIMARY KEY NOT NULL,
	`academy_id` text NOT NULL,
	`membership_id` text,
	`transaction_id` text,
	`attempt_number` integer NOT NULL,
	`scheduled_at` text NOT NULL,
	`attempted_at` text,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`provider` text,
	`failure_code` text,
	`failure_message` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`academy_id`) REFERENCES `academies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `payment_retries_due_idx` ON `payment_retries` (`status`,`scheduled_at`);--> statement-breakpoint
CREATE TABLE `retail_products` (
	`id` text PRIMARY KEY NOT NULL,
	`academy_id` text NOT NULL,
	`sku` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`category` text DEFAULT 'other' NOT NULL,
	`price_cents` integer NOT NULL,
	`cost_cents` integer,
	`currency` text DEFAULT 'MYR' NOT NULL,
	`stock_quantity` integer DEFAULT 0 NOT NULL,
	`low_stock_threshold` integer DEFAULT 5 NOT NULL,
	`track_inventory` integer DEFAULT true NOT NULL,
	`size` text,
	`color` text,
	`image_url` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`academy_id`) REFERENCES `academies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `retail_sku_uq` ON `retail_products` (`academy_id`,`sku`);--> statement-breakpoint
CREATE TABLE `transaction_items` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`product_id` text,
	`description` text NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`unit_price_cents` integer NOT NULL,
	`total_cents` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `retail_products`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `transaction_items_tx_idx` ON `transaction_items` (`transaction_id`);--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`academy_id` text NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`user_id` text,
	`payer_id` text,
	`membership_id` text,
	`payment_method_id` text,
	`subtotal_cents` integer NOT NULL,
	`discount_cents` integer NOT NULL,
	`tax_cents` integer NOT NULL,
	`total_cents` integer NOT NULL,
	`currency` text DEFAULT 'MYR' NOT NULL,
	`provider` text DEFAULT 'manual' NOT NULL,
	`provider_transaction_id` text,
	`provider_payment_intent_id` text,
	`idempotency_key` text NOT NULL,
	`failure_code` text,
	`failure_message` text,
	`processed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`academy_id`) REFERENCES `academies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`payer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`payment_method_id`) REFERENCES `payment_methods`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_idempotency_key_unique` ON `transactions` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `transactions_user_idx` ON `transactions` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `transactions_academy_date_idx` ON `transactions` (`academy_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `transactions_provider_idx` ON `transactions` (`provider`,`provider_transaction_id`);--> statement-breakpoint
CREATE TABLE `notification_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`academy_id` text NOT NULL,
	`type` text NOT NULL,
	`recipient_user_id` text NOT NULL,
	`channel` text NOT NULL,
	`payload` text NOT NULL,
	`dedupe_key` text,
	`scheduled_at` text NOT NULL,
	`sent_at` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`academy_id`) REFERENCES `academies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipient_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_jobs_dedupe_key_unique` ON `notification_jobs` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `notification_due_idx` ON `notification_jobs` (`status`,`scheduled_at`);--> statement-breakpoint
CREATE TABLE `webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`academy_id` text,
	`provider` text NOT NULL,
	`external_event_id` text NOT NULL,
	`event_type` text NOT NULL,
	`signature_valid` integer DEFAULT false NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'received' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`processed_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`academy_id`) REFERENCES `academies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `webhook_event_uq` ON `webhook_events` (`provider`,`external_event_id`);--> statement-breakpoint
CREATE INDEX `webhook_status_idx` ON `webhook_events` (`status`,`created_at`);