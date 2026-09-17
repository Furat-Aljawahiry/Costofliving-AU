output "aws_account_id" {
  description = "AWS account Terraform is authenticated against"
  value       = data.aws_caller_identity.current.account_id
}

output "aws_region" {
  description = "Region resources are deployed into"
  value       = var.aws_region
}

output "data_bucket" {
  description = "S3 bucket holding all collected report output"
  value       = aws_s3_bucket.data.id
}

output "woolworths_output_path" {
  description = "Where the Woolworths fruit & veg reports land"
  value       = "s3://${aws_s3_bucket.data.id}/${var.woolworths_output_prefix}/"
}

output "woolworths_category_function" {
  description = "Name of the Woolworths category crawler Lambda"
  value       = aws_lambda_function.woolworths_category.function_name
}

output "woolworths_invoke_command" {
  description = "Run the crawler once, on demand"
  value       = "aws lambda invoke --function-name ${aws_lambda_function.woolworths_category.function_name} --region ${var.aws_region} out.json && cat out.json"
}

output "coles_output_path" {
  description = "Where the Coles fruit & vegetables reports land — a separate prefix from Woolworths, same schema"
  value       = "s3://${aws_s3_bucket.data.id}/${var.coles_output_prefix}/"
}

output "coles_category_function" {
  description = "Name of the Coles category crawler Lambda"
  value       = aws_lambda_function.coles_category.function_name
}

output "coles_invoke_command" {
  description = "Run the Coles crawler once, on demand. Do this before enabling its schedule: whether AWS egress is blocked is unmeasured (COLES_DISCOVERY.md section 5.4)"
  value       = "aws lambda invoke --function-name ${aws_lambda_function.coles_category.function_name} --region ${var.aws_region} out.json && cat out.json"
}

output "fruitveg_category_function" {
  description = "Name of the combined Fruit & Veg crawler — one invocation crawls both retailers"
  value       = aws_lambda_function.fruitveg_category.function_name
}

output "fruitveg_invoke_command" {
  description = "Run both retailers once, on demand. Every page of Fruit & Veg at Woolworths and at Coles, into three prefixes under one run_id"
  value       = "aws lambda invoke --function-name ${aws_lambda_function.fruitveg_category.function_name} --region ${var.aws_region} out.json && cat out.json"
}

output "combined_output_path" {
  description = "Where the union of both retailers' Fruit & Veg rows lands. Empty when combined_output_prefix is unset"
  value       = var.combined_output_prefix == "" ? "" : "s3://${aws_s3_bucket.data.id}/${var.combined_output_prefix}/"
}
