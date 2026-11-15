-- KEYS: 1 stock, 2 buyers, 3 idempotency (scoped by event+user), 4 telemetry
-- ARGV: 1 userId, 2 idempotency TTL (s), 3 reservationId
local existing = redis.call('GET', KEYS[3])
if existing then
    return {-3, existing}            -- replay: return the ORIGINAL reservationId
end

local currentStock = tonumber(redis.call('GET', KEYS[1]) or '0')
if currentStock <= 0 then
    redis.call('HINCRBY', KEYS[4], 'rejected_sold_out', 1)
    return {-1}
end

if redis.call('SISMEMBER', KEYS[2], ARGV[1]) == 1 then
    redis.call('HINCRBY', KEYS[4], 'rejected_duplicate', 1)
    return {-2}
end

redis.call('DECR', KEYS[1])
redis.call('SADD', KEYS[2], ARGV[1])
redis.call('SET', KEYS[3], ARGV[3], 'EX', tonumber(ARGV[2]))
redis.call('HINCRBY', KEYS[4], 'accepted_at_edge', 1)
return {1, ARGV[3]}