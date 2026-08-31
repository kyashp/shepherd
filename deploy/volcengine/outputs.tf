output "instance_id" {
  description = "ECS instance ID."
  value       = volcenginecc_ecs_instance.launchpad.id
}

output "public_ip" {
  description = "ECS public IP."
  value       = volcenginecc_ecs_instance.launchpad.eip_address.ip_address
}

output "app_url" {
  description = "Agent Launchpad URL returned after the deploy script completes."
  value       = "http://${volcenginecc_ecs_instance.launchpad.eip_address.ip_address}"
}
