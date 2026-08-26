ALTER TABLE `benchmark_results` ADD `encode_ms` integer;--> statement-breakpoint
ALTER TABLE `benchmark_results` ADD `queue_ms` integer;--> statement-breakpoint
ALTER TABLE `benchmark_results` ADD `prefill_ms` integer;--> statement-breakpoint
ALTER TABLE `benchmark_results` ADD `decode_ms` integer;--> statement-breakpoint
ALTER TABLE `benchmark_results` ADD `inter_token_p50_ms` real;--> statement-breakpoint
ALTER TABLE `benchmark_results` ADD `inter_token_p95_ms` real;--> statement-breakpoint
ALTER TABLE `benchmark_results` ADD `stream_chunks` integer;