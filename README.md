# Nightly Report Generator

A Node.js application that generates comprehensive daily reports on Manna's drone delivery operations. The report includes analysis of:

- Slack communications from multiple channels
- Customer service interactions
- Delivery performance metrics
- Order statistics
- Customer feedback

## Usage

```bash
# Set required environment variables
export CLAUDE_API_KEY=your_claude_api_key
export SLACK_TOKEN=your_slack_token
export PERPLEXITY_API_KEY=your_perplexity_api_key  # For Deepseek model
export GROK_API_KEY=your_grok_api_key  # For Grok model

# Run the report
node report.js [date_range] [db_password] [model]

# Where:
# - date_range: "today", "yesterday", "last7", or "last30"
# - db_password: Password for the database connection
# - model: "sonnet", "sonnet-3.7", "opus", "deepseek", or "grok"
```

## Output

The report is saved to a text file named `daily-report-YYYY-MM-DD.txt` in the project directory.

## Style-guide

This project follows standard JavaScript style guidelines.
