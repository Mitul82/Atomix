-- KEYS[1] = stock key          (e.g., "atomix:event:1:stock")
-- KEYS[2] = buyers set key     (e.g., "atomix:event:1:buyers")
-- KEYS[3] = idempotency key    (e.g., "atomix:idemp:abc-123")
-- KEYS[4] = telemetry hash key (e.g., "atomix:event:1:telemetry")
-- ARGV[1] = userId             (e.g., "user_42")
-- ARGV[2] = idempotency TTL    (e.g., "300" seconds)

-- 1. Check Idempotency: Did this exact request already run?
if redis.call('EXISTS', KEYS[3]) == 1 then
    return -3 -- Code -3: Idempotent duplicate retry
end

-- 2. Check Duplicate Buyer: Did this user already reserve this flash-sale item?
if redis.call('SISMEMBER', KEYS[2], ARGV[1]) == 1 then
    redis.call('HINCRBY', KEYS[4], 'rejected_duplicate', 1)
    return -2 -- Code -2: User already bought 1 item
end

-- 3. Check Stock Availability
local currentStock = tonumber(redis.call('GET', KEYS[1]) or "0")
if currentStock <= 0 then
    redis.call('HINCRBY', KEYS[4], 'rejected_sold_out', 1)
    return -1 -- Code -1: Sold Out!
end

-- 4. All checks passed! Atomically reserve the item:
redis.call('DECR', KEYS[1])
redis.call('SADD', KEYS[2], ARGV[1])
redis.call('SET', KEYS[3], ARGV[1], 'EX', tonumber(ARGV[2]))
redis.call('HINCRBY', KEYS[4], 'accepted_at_edge', 1)

return 1 -- Code 1: Successfully Reserved!