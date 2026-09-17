data "archive_file" "test" {
  type        = "zip"
  source_dir  = "${path.module}/lambda/test"
  output_path = "${path.module}/lambda/test.zip"
}

resource "aws_iam_role" "test_lambda" {
  name = "${var.project_name}-test-lambda"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "test_lambda_basic_execution" {
  role       = aws_iam_role.test_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_lambda_function" "test" {
  function_name = "${var.project_name}-test"
  role          = aws_iam_role.test_lambda.arn
  handler       = "handler.handler"
  runtime       = "python3.13"

  filename         = data.archive_file.test.output_path
  source_code_hash = data.archive_file.test.output_base64sha256
}
