import { WebClient } from '@slack/web-api';
import fs from 'fs/promises';
import pg from 'pg';
import axios from 'axios';

// Validate required environment variables
if (!process.env.CLAUDE_API_KEY) {
  console.error('Please set CLAUDE_API_KEY environment variable');
  process.exit(1);
}

if (!process.env.SLACK_TOKEN) {
  console.error('Please set SLACK_TOKEN environment variable');
  process.exit(1);
}

const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
const SLACK_TOKEN = process.env.SLACK_TOKEN;
const CHANNELS = {
  'cx-survey': 'C02R2ALR8P7',
  'blanchardstown-updates': 'C06G52DAY91',
  'blanchardstown-issues': 'C06G55PC19Q',
  'urgent_issues': 'C06TVAT4MQ9',
  'customer-service': 'C02R2GH5WNM',
  'blanchardstown-operations-comms':'C07F2E2FC5P'
};

const slack = new WebClient(SLACK_TOKEN);

// Add at the top with other constants
const VALID_MODELS = ['sonnet', 'sonnet-3.7', 'opus', 'deepseek', 'grok'];

// Update command line argument validation
const validDates = ['today', 'yesterday', 'last7', 'last30'];
const dateArg = process.argv[2];
const dbPassword = process.argv[3];
const modelArg = process.argv[4]?.toLowerCase();

if (!validDates.includes(dateArg)) {
  console.error('Please specify date as first argument: "today", "yesterday", "last7", or "last30"');
  process.exit(1);
}

if (!dbPassword) {
  console.error('Please provide database password as second argument');
  process.exit(1);
}

if (!modelArg || !VALID_MODELS.includes(modelArg)) {
  console.error('Please specify model as third argument: "sonnet", "opus", "deepseek", or "grok"');
  process.exit(1);
}

// Add Perplexity API key check
if (modelArg === 'deepseek' && !process.env.PERPLEXITY_API_KEY) {
  console.error('Please set PERPLEXITY_API_KEY environment variable for Deepseek model');
  process.exit(1);
}

// Add Grok API key check
if (modelArg === 'grok' && !process.env.GROK_API_KEY) {
  console.error('Please set GROK_API_KEY environment variable for Grok model');
  process.exit(1);
}

// Configure date based on argument
const reportDate = (() => {
  const now = new Date();
  switch (dateArg) {
    case 'today':
      return now;
    case 'yesterday':
      return new Date(Date.now() - 86400000);
    case 'last7':
      return new Date(Date.now() - (7 * 86400000));
    case 'last30':
      return new Date(Date.now() - (30 * 86400000));
    default:
      return now;
  }
})();
reportDate.setHours(0,0,0,0);

const dbConfig = {
  user: process.env.DB_USER || 'bobby',
  host: process.env.DB_HOST || 'aa19wdx3bzov7xi.cuxusgp97ka5.eu-west-1.rds.amazonaws.com',
  database: process.env.DB_NAME || 'ebdb',
  port: process.env.DB_PORT || 5432,
  password: dbPassword
};

// Add at the top with other constants
const userCache = new Map();

// Add constant for system users to ignore
const IGNORED_USERS = ['OrderEnhancerBot', 'Typeform'];

// Modified getUserName function to fetch actual names from Slack API
async function getUserName(userId) {
  if (!userId) return 'Unknown User';
  
  if (userCache.has(userId)) {
    return userCache.get(userId);
  }

  try {
    const result = await slack.users.info({ user: userId });
    // Prefer display name, fall back to real name, then username, then ID
    const displayName = result.user.profile.display_name || 
                       result.user.profile.real_name || 
                       result.user.name ||
                       userId;
    userCache.set(userId, displayName);
    return displayName;
  } catch (error) {
    console.warn(`Warning: Could not fetch user info for ${userId}: ${error.message}`);
    // Fall back to user ID if API call fails
    const fallbackName = `User-${userId.substring(0, 6)}`;
    userCache.set(userId, fallbackName);
    return fallbackName;
  }
}

async function getSlackMessages() {
  const allMessages = {};
  
  for (const [channelName, channelId] of Object.entries(CHANNELS)) {
    try {
      const result = await slack.conversations.history({
        channel: channelId,
        oldest: reportDate.getTime() / 1000,
        latest: dateArg === 'today' ? undefined : 
               dateArg === 'yesterday' ? new Date(reportDate.getTime() + 86400000).getTime() / 1000 :
               new Date().getTime() / 1000
      });
      
      // Fetch replies for each message that has replies
      const messagesWithReplies = await Promise.all(
        result.messages.map(async (message) => {
          if (message.reply_count && message.reply_count > 0) {
            try {
              const replies = await slack.conversations.replies({
                channel: channelId,
                ts: message.ts
              });
              
              // Remove the parent message from replies to avoid duplication
              const threadReplies = replies.messages.filter(reply => reply.ts !== message.ts);
              return {
                ...message,
                replies: threadReplies
              };
            } catch (error) {
              console.warn(`Warning: Could not fetch replies for message in ${channelName}: ${error.message}`);
              return message;
            }
          }
          return message;
        })
      );
      
      allMessages[channelName] = messagesWithReplies;
    } catch (error) {
      console.warn(`Warning: Could not fetch messages from ${channelName}: ${error.message}`);
      allMessages[channelName] = [];
    }
  }
  
  return allMessages;
}

async function getDailyOrders() {
  const client = new pg.Client(dbConfig);
  await client.connect();

  const query = `
    /* Daily orders analysis for ${dateArg} report with metrics calculation */
    WITH base_orders AS (
      SELECT * FROM api.get_orders(7,
        (${
          dateArg === 'today' ? 'CURRENT_DATE' : 
          dateArg === 'yesterday' ? 'CURRENT_DATE - interval \'1 day\'' :
          dateArg === 'last7' ? 'CURRENT_DATE - interval \'7 days\'' :
          'CURRENT_DATE - interval \'30 days\''
        })::timestamp,
        (${
          dateArg === 'today' ? 'CURRENT_DATE + interval \'1 day\'' : 
          dateArg === 'yesterday' ? 'CURRENT_DATE' :
          'CURRENT_DATE'
        })::timestamp
      )
    ),
    order_metrics AS (
      SELECT 
        *,
        CASE 
          WHEN late_by_mins IS NULL OR late_by_mins < 10 THEN 0
          ELSE late_by_mins
        END as significant_delay_mins,
        repeat not ilike '%new cx%' as is_repeat_customer
      FROM base_orders
    ),
    repeat_customer_history AS (
      SELECT 
        o.eircode,
        COUNT(*) as orders_30d
      FROM api.v_validOrders o
      WHERE o.eircode IN (SELECT DISTINCT eircode FROM order_metrics)
      and o.create_date > CURRENT_DATE - interval '30 days'
      GROUP BY o.eircode
    ),
    order_stats AS (
      SELECT
        COUNT(*) as total_orders,
        COUNT(*) FILTER (WHERE status = 'COMPLETE'::text) as completed_orders,
        COUNT(*) FILTER (WHERE is_repeat_customer) as repeat_customer_orders,
        COUNT(*) FILTER (WHERE NOT is_repeat_customer) as new_customer_orders,
        COUNT(*) FILTER (WHERE promo_id IS NOT NULL) as promo_orders,
        COALESCE(SUM(CASE WHEN voucher_amount IS NOT NULL THEN voucher_amount ELSE 0 END), 0) as total_voucher_amount,
        COUNT(*) FILTER (WHERE voucher_amount IS NOT NULL) as orders_with_vouchers,
        
        -- Delivery time stats for all orders
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY "ordered->delivered") as median_delivery_time,
        AVG("ordered->delivered") as avg_delivery_time,
        
        -- New customer stats
        AVG("ordered->delivered") FILTER (WHERE NOT is_repeat_customer) as new_customer_avg_delivery_time,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY "ordered->delivered") FILTER (WHERE NOT is_repeat_customer) as new_customer_median_delivery_time,
        COUNT(*) FILTER (WHERE NOT is_repeat_customer AND voucher_amount IS NOT NULL) as new_customer_voucher_count,
        
        -- Repeat customer stats
        COUNT(DISTINCT om.eircode) FILTER (WHERE is_repeat_customer) as unique_repeat_customers,
        COALESCE(SUM(rch.orders_30d), 0) as total_repeat_orders_30d,
        COUNT(*) FILTER (WHERE is_repeat_customer AND promo_id IS NOT NULL) as repeat_customer_promo_orders,
        
        -- Average number of previous orders for repeat customers
        AVG(CASE WHEN is_repeat_customer THEN repeat::numeric ELSE NULL END) as avg_previous_orders_per_repeat_customer
      FROM order_metrics om
      LEFT JOIN repeat_customer_history rch ON om.eircode = rch.eircode
    )
    SELECT 
      om.*,
      -- Calculate averages
      CASE 
        WHEN unique_repeat_customers > 0 
        THEN ROUND(total_repeat_orders_30d::numeric / unique_repeat_customers, 2)
        ELSE 0 
      END as avg_orders_per_repeat_customer_30d
    FROM order_stats om;
  `;

  const metricsResult = await client.query(query);
  
  // Get detailed order data for CSV
  const ordersQuery = `
    SELECT * FROM (
      SELECT * FROM api.get_orders(7,
        (${
          dateArg === 'today' ? 'CURRENT_DATE' : 
          dateArg === 'yesterday' ? 'CURRENT_DATE - interval \'1 day\'' :
          dateArg === 'last7' ? 'CURRENT_DATE - interval \'7 days\'' :
          'CURRENT_DATE - interval \'30 days\''
        })::timestamp,
        (${
          dateArg === 'today' ? 'CURRENT_DATE + interval \'1 day\'' : 
          dateArg === 'yesterday' ? 'CURRENT_DATE' :
          'CURRENT_DATE'
        })::timestamp
      )
    ) o ORDER BY create_date;
  `;
  
  const ordersResult = await client.query(ordersQuery);
  await client.end();
  
  return {
    metrics: metricsResult.rows[0],
    orders: ordersResult.rows
  };
}

// Modify processMessages to use real names
const processMessages = (messages) => {
  return Promise.all(messages.map(async (msg, index) => {
    if (!msg.replies?.length) {
      return {
        message_number: index + 1,
        text: msg.text,
        user: await getUserName(msg.user)
      };
    }
    
    return {
      message_number: index + 1,
      text: msg.text,
      user: await getUserName(msg.user),
      thread_replies: await Promise.all(msg.replies.map(async (reply, replyIndex) => ({
        reply_number: replyIndex + 1,
        text: reply.text,
        user: await getUserName(reply.user)
      })))
    };
  }));
};

async function generatePrompt(slackMessages, orderData) {
  // Process cx-survey messages to extract only ratings and comments
  const surveyMessages = slackMessages['cx-survey'].map(msg => {
    const ratingMatch = msg.text?.match(/Rating:\s*(\d+)/i);
    const commentMatch = msg.text?.match(/Comment:\s*(.+)/i);
    
    return {
      rating: ratingMatch ? parseInt(ratingMatch[1]) : null,
      comment: commentMatch ? commentMatch[1].trim() : null
    };
  }).filter(msg => msg.rating !== null || msg.comment !== null);

  // Calculate message statistics by user, excluding system users
  const userStats = {};
  await Promise.all(Object.entries(slackMessages).map(async ([channel, messages]) => {
    await Promise.all(messages.map(async msg => {
      const userName = await getUserName(msg.user);
      if (!IGNORED_USERS.includes(userName)) {
        if (!userStats[userName]) {
          userStats[userName] = {
            total_messages: 0,
            total_replies: 0,
            channels: new Set()
          };
        }
        userStats[userName].total_messages++;
        userStats[userName].channels.add(channel);
      }

      if (msg.replies) {
        await Promise.all(msg.replies.map(async reply => {
          const replyUserName = await getUserName(reply.user);
          if (!IGNORED_USERS.includes(replyUserName)) {
            if (!userStats[replyUserName]) {
              userStats[replyUserName] = {
                total_messages: 0,
                total_replies: 0,
                channels: new Set()
              };
            }
            userStats[replyUserName].total_replies++;
            userStats[replyUserName].channels.add(channel);
          }
        }));
      }
    }));
  }));

  // Convert Set to array for JSON serialization
  Object.values(userStats).forEach(stats => {
    stats.channels = Array.from(stats.channels);
  });

  // Format orders as CSV with order numbers
  const excludedColumns = ['cell_id', 'droplat', 'droplng', 'mission_id', 'weight', 'device', 'original_order_id'];
  const orderHeaders = 'order_number,' + Object.keys(orderData.orders[0] || {})
    .filter(key => !excludedColumns.includes(key))
    .join(',');

  const orderRows = orderData.orders.map((order, index) => {
    const values = [index + 1];
    Object.entries(order).forEach(([key, val]) => {
      if (excludedColumns.includes(key)) return;
      
      // Format dates and timestamps
      if (val instanceof Date || (typeof val === 'string' && val.match(/^\d{4}-\d{2}-\d{2}/))) {
        val = new Date(val).toLocaleString('en-GB', {
          day: '2-digit',
          month: '2-digit',
          year: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        });
      }
      
      // Handle other values
      values.push(
        val === null ? '' : 
        String(val).includes(',') ? `"${String(val)}"` : 
        String(val)
      );
    });
    return values.join(',');
  }).join('\n\n');
  const ordersCSV = `${orderHeaders}\n\n${orderRows}`;

  const { metrics, orders } = orderData;

  const userStatsHeader = 'User,Messages,Replies,Channels';
  const userStatsRows = Object.entries(userStats).map(([user, stats]) => {
    const channels = stats.channels.join('|');
    return `"${user}",${stats.total_messages},${stats.total_replies},"${channels}"`;
  }).join('\n');

  const userActivityStats = `${userStatsHeader}\n${userStatsRows}`;

  const prompt = `You are an AI analyst tasked with producing a comprehensive ${
    dateArg === 'today' ? 'end-of-day' : 
    dateArg === 'yesterday' ? 'previous day' :
    dateArg === 'last7' ? 'last 7 days' :
    'last 30 days'
  } report for Manna's drone delivery operations. Please analyze the following data and provide:

1. Executive Summary
   - Start with: "This report was generated using ${
     modelArg === 'deepseek' ? 'Perplexity API (Deepseek model)' :
     modelArg === 'grok' ? 'X.AI Grok-1 model' :
     modelArg === 'sonnet-3.7' ? 'Anthropic\'s Claude-3.7 Sonnet model' :
     `Anthropic's Claude-3 ${modelArg} model`
   }"
   - Then continue with the summary
2. Operational Performance Analysis
   - Include median time from order to delivery
   - Analysis of delivery time distribution
3. Customer Analysis
   - Repeat Customers:
     * Average number of orders per repeat customer in the past 30 days
     * Promotion usage among repeat customers
   - New Customers:
     * Average and median delivery times for first-time customers
     * Voucher usage among new customers
   - Total cost of promotions and discounts for the day
4. Communication Analysis
5. Financial Analysis
6. Key Issues and Recommendations

Today's Data:

COMMUNICATION PATTERNS
User Activity Statistics:
${userActivityStats}

CUSTOMER FEEDBACK AND OPERATIONAL COMMUNICATIONS

Customer Survey Ratings and Comments:
${JSON.stringify(surveyMessages, null, 2)}

Blanchardstown Updates (messages are numbered, replies are shown as thread_replies under their parent message):
${JSON.stringify(processMessages(slackMessages['blanchardstown-updates']), null, 2)}

Blanchardstown Issues (messages are numbered, replies are shown as thread_replies under their parent message):
${JSON.stringify(processMessages(slackMessages['blanchardstown-issues']), null, 2)}

Urgent Issues (messages are numbered, replies are shown as thread_replies under their parent message):
${JSON.stringify(processMessages(slackMessages['urgent_issues']), null, 2)}

Customer Service Messages (messages are numbered, replies are shown as thread_replies under their parent message):
${JSON.stringify(processMessages(slackMessages['customer-service']), null, 2)}

Ops Comms Messages (messages are numbered, replies are shown as thread_replies under their parent message):
${JSON.stringify(processMessages(slackMessages['blanchardstown-operations-comms']), null, 2)}

DELIVERY ORDERS AND METRICS
Note: Each unique order_id represents one order
Note: All timestamps in the order data are in seconds since epoch, except for late_by_mins and vendor_delay which are in minutes
Note: The "ordered->delivered" column shows the time from order to delivery in seconds. Please calculate and analyze delivery time metrics.

ORDER METRICS SUMMARY
Total Orders: ${metrics.total_orders}
Completed Orders: ${metrics.completed_orders}

Delivery Times:
- Median Delivery Time: ${Math.round(metrics.median_delivery_time)} seconds
- Average Delivery Time: ${Math.round(metrics.avg_delivery_time)} seconds

New Customers:
- Number of Orders: ${metrics.new_customer_orders}
- Average Delivery Time: ${Math.round(metrics.new_customer_avg_delivery_time)} seconds
- Median Delivery Time: ${Math.round(metrics.new_customer_median_delivery_time)} seconds
- Orders with Vouchers: ${metrics.new_customer_voucher_count}

Repeat Customers:
- Number of Orders: ${metrics.repeat_customer_orders}
- Unique Customers: ${metrics.unique_repeat_customers}
- Average Orders per Customer (30 days): ${metrics.avg_orders_per_repeat_customer_30d}
- Orders with Promotions: ${metrics.repeat_customer_promo_orders}

Promotions and Discounts:
- Total Orders with Promos: ${metrics.promo_orders}
- Total Orders with Vouchers: ${metrics.orders_with_vouchers}
- Total Voucher Amount: €${Math.abs(metrics.total_voucher_amount).toFixed(2)}

DETAILED ORDER DATA
Note: Each unique order_id represents one order
Note: All timestamps are in seconds since epoch, except for late_by_mins and vendor_delay which are in minutes
Note: Dates are formatted as DD/MM/YY HH:mm
Note: The "ordered->delivered" column shows the time from order to delivery in seconds

${ordersCSV}

Please pay special attention to:

- Analyzing significant order delays (significant_delay_mins >= 10) and vendor delays (vendor_delay). Note that delays under 10 minutes are not considered significant.
- Delivery time performance, including median and outlier delivery times. Please include the median time from order to delivery in the Executive Summary and Operational Performance sections.
- Customer sentiment from review scores, review notes and Slack messages
- Time from order to delivery (ordered->delivered field)
- Customer retention metrics (repeat field and eircode patterns)
- Financial performance (revenue field)
- Operational issues indicated in resend_reason and mc_notes fields
- Patterns in customer support conversations from Slack
- Any urgent issues or operational problems reported in the Blanchardstown channels
- Correlation between customer service issues and operational updates
- Communication patterns and team engagement across channels
- Key contributors and their areas of focus based on channel activity
- Response patterns in customer service interactions
- Team collaboration patterns in issue resolution
- Customer segmentation analysis:
  * For repeat customers, analyze their order frequency over the past 30 days
  * For new customers, analyze their delivery times and voucher usage
  * Calculate total promotional costs and discount impact
  * Identify patterns in promotion effectiveness

Structure your analysis to highlight key insights, trends, and actionable recommendations. Include relevant metrics and specific examples where helpful. Format the report in clear sections with headers.`;

  return prompt;
}

// Modify getClaudeAnalysis to handle different models
async function getAnalysis(prompt) {
  try {
    if (modelArg === 'deepseek') {

      const response = await axios.post('https://api.perplexity.ai/chat/completions', {
        model: 'sonar',
        messages: [{
          role: 'system',
          content: 'You are an AI analyst tasked with analyzing business data and producing comprehensive reports.'
        }, {
          role: 'user',
          content: prompt
        }]
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`
        }
      });

      if (!response.data?.choices?.[0]?.message?.content) {
        throw new Error('Unexpected response format from Perplexity API');
      }

      return response.data.choices[0].message.content;

    } else if (modelArg === 'grok') {
      const response = await axios.post('https://api.x.ai/v1/chat/completions', {
        model: 'grok-2-latest',
        messages: [{
          role: 'system',
          content: 'You are an AI analyst tasked with analyzing business data and producing comprehensive reports.'
        }, {
          role: 'user',
          content: prompt
        }],
        temperature: 0.7,
        max_tokens: 4000
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.GROK_API_KEY}`
        }
      });

      if (!response.data?.choices?.[0]?.message?.content) {
        throw new Error('Unexpected response format from Grok API');
      }

      return response.data.choices[0].message.content;
    } else {
      // Claude API - updated for 3.7 support
      const response = await axios.post('https://api.anthropic.com/v1/messages', {
        model: modelArg === 'sonnet-3.7' ? 'claude-3-7-sonnet-20250219' : 
               modelArg === 'sonnet' ? 'claude-3-sonnet-20240229' : 
               'claude-3-opus-20240229',
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: prompt
        }]
      }, {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': CLAUDE_API_KEY,
          'anthropic-version': '2023-06-01'
        }
      });

      if (!response.data?.content?.[0]?.text) {
        throw new Error('Unexpected response format from Claude API');
      }

      return response.data.content[0].text;
    }
  } catch (error) {
    if (error.response) {
      console.error(`${modelArg.toUpperCase()} API error:`, {
        status: error.response.status,
        data: error.response.data
      });
    }
    throw error;
  }
}

async function main() {
  try {
    console.log(`Gathering data for ${dateArg}...`);
    const [slackMessages, orderData] = await Promise.all([
      getSlackMessages().catch(err => {
        console.error('Error fetching Slack messages:', err);
        return {};
      }),
      getDailyOrders().catch(err => {
        console.error('Error fetching orders:', err);
        return {};
      })
    ]);

    if (!Object.values(slackMessages).some(msgs => msgs.length > 0) && !orderData.orders.length) {
      throw new Error('No data available to generate report');
    }

    // Add data summary logging
    console.log('\nData Summary:');
    console.log('Slack messages by channel:');
    Object.entries(slackMessages).forEach(([channel, messages]) => {
      const replyCount = messages.reduce((count, msg) => 
        count + (msg.replies?.length || 0), 0);
      console.log(`- ${channel}: ${messages.length} messages, ${replyCount} replies`);
    });

    console.log(`\nOrders: ${orderData.orders.length}`);
    console.log(`Date range: ${reportDate.toISOString().split('T')[0]} to ${
      dateArg === 'today' ? new Date().toISOString().split('T')[0] :
      dateArg === 'yesterday' ? new Date(reportDate.getTime() + 86400000).toISOString().split('T')[0] :
      new Date().toISOString().split('T')[0]
    }`);
    
    if (orderData.orders.length > 0) {
      const completed = orderData.orders.filter(o => o.status === 'COMPLETE').length;
      const revenue = orderData.orders.reduce((sum, o) => sum + (parseFloat(o.revenue) || 0), 0);
      
      // Calculate median delivery time
      const deliveryTimes = orderData.orders
        .filter(o => o['ordered->delivered']) // Filter out null values
        .map(o => parseInt(o['ordered->delivered']))
        .sort((a, b) => a - b);
      
      const medianDeliveryTime = deliveryTimes.length > 0 
        ? deliveryTimes[Math.floor(deliveryTimes.length / 2)]
        : null;
      
      console.log(`- Completed orders: ${completed}`);
      console.log(`- Total revenue: €${revenue.toFixed(2)}`);
      if (medianDeliveryTime) {
        console.log(`- Median delivery time: ${medianDeliveryTime} seconds (${(medianDeliveryTime/60).toFixed(1)} minutes)`);
      }
    }

    console.log('\nGenerating prompt...');
    const prompt = await generatePrompt(slackMessages, orderData);
    
    console.log(`Getting analysis from ${modelArg.toUpperCase()}...`);
    const analysis = await getAnalysis(prompt);

    const filename = `daily-report-${reportDate.toISOString().split('T')[0]}.txt`;
    
    await fs.writeFile(filename, analysis);
    console.log(`Report saved to ${filename}`);
  } catch (error) {
    console.error('Failed to generate report:', error.message);
    process.exit(1);
  }
}

// Add proper signal handling
process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
  process.exit(1);
});

// Run the report
main();