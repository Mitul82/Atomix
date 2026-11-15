-- KEYS: 1 stock, 2 buyers, 3 idempotency, 4 telemetry ; ARGV: 1 userId, 2 reservationId
-- Only undoes THIS reservation, and only once.
if redis.call('GET', KEYS[3]) == ARGV[2] and redis.call('SISMEMBER', KEYS[2], ARGV[1]) == 1 then
    redis.call('INCR', KEYS[1])
    redis.call('SREM', KEYS[2], ARGV[1])
    redis.call('DEL', KEYS[3])
    redis.call('HINCRBY', KEYS[4], 'accepted_at_edge', -1)
    return 1
end

return 0