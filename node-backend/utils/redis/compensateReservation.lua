-- KEYS[1] = stock key          (e.g., "atomix:event:1:stock")
-- KEYS[2] = buyers set key     (e.g., "atomix:event:1:buyers")
-- KEYS[3] = idempotency key    (e.g., "atomix:idemp:abc-123")
-- KEYS[4] = telemetry hash key (e.g., "atomix:event:1:telemetry")
-- ARGV[1] = userId             (e.g., "user_42")

-- Only compensate if the user is currently recorded in the buyers set
if redis.call('SISMEMBER', KEYS[2], ARGV[1]) == 1 then
    redis.call('INCR', KEYS[1])
    redis.call('SREM', KEYS[2], ARGV[1])
    redis.call('DEL', KEYS[3])
    redis.call('HINCRBY', KEYS[4], 'accepted_at_edge', -1)
    return 1
end

return 0