/* Query to analyze orders with 10-minute grace period for lateness */
SELECT 
  o.order_id,
  o.create_date,
  o.promised_time,
  o.actual_delivery_time,
  CASE 
    WHEN o.actual_delivery_time > (o.promised_time + interval '10 minutes') THEN true
    ELSE false 
  END as is_late,
  CASE
    WHEN o.actual_delivery_time IS NOT NULL THEN 
      EXTRACT(EPOCH FROM (o.actual_delivery_time - o.promised_time))/60.0
    ELSE NULL
  END as delivery_delay_minutes
FROM api.v_validorders o
WHERE o.create_date::date = CURRENT_DATE - 1 