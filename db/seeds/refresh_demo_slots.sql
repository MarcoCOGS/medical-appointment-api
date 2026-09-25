SET time_zone = '+00:00';
SET @demo_time_zone = (SELECT time_zone FROM medical_centers WHERE center_id = 1);

SELECT CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', @demo_time_zone) AS time_zone_check;

INSERT INTO schedule_slots
  (center_id, specialty_id, medic_id, starts_at_utc, ends_at_utc)
WITH RECURSIVE
  days (day_number) AS (
    SELECT 1
    UNION ALL
    SELECT day_number + 1 FROM days WHERE day_number < 14
  ),
  half_hours (slot_number) AS (
    SELECT 0
    UNION ALL
    SELECT slot_number + 1 FROM half_hours WHERE slot_number < 29
  ),
  demo_medics (medic_id, specialty_id) AS (
    SELECT 1, 1
    UNION ALL
    SELECT 2, 2
  )
SELECT
  CASE WHEN MOD(TO_DAYS(local_slots.local_day) + local_slots.medic_id, 2) = 0
    THEN 1 ELSE 2 END AS center_id,
  local_slots.specialty_id,
  local_slots.medic_id,
  CONVERT_TZ(local_slots.local_start, @demo_time_zone, '+00:00'),
  CONVERT_TZ(DATE_ADD(local_slots.local_start, INTERVAL 30 MINUTE),
    @demo_time_zone, '+00:00')
FROM (
  SELECT
    m.medic_id,
    m.specialty_id,
    DATE_ADD(DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', @demo_time_zone)),
      INTERVAL d.day_number DAY) AS local_day,
    DATE_ADD(
      DATE_ADD(DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', @demo_time_zone)),
        INTERVAL d.day_number DAY),
      INTERVAL (360 + h.slot_number * 30) MINUTE
    ) AS local_start
  FROM days AS d
  CROSS JOIN half_hours AS h
  CROSS JOIN demo_medics AS m
) AS local_slots
WHERE TRUE
ON DUPLICATE KEY UPDATE schedule_id = schedule_id;
