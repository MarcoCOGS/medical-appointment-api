SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  applied_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (version)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS medical_centers (
  center_id SMALLINT UNSIGNED NOT NULL,
  name VARCHAR(120) NOT NULL,
  time_zone VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (center_id),
  UNIQUE KEY uq_medical_centers_name (name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS specialties (
  specialty_id SMALLINT UNSIGNED NOT NULL,
  name VARCHAR(120) NOT NULL,
  PRIMARY KEY (specialty_id),
  UNIQUE KEY uq_specialties_name (name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS medics (
  medic_id SMALLINT UNSIGNED NOT NULL,
  full_name VARCHAR(120) NOT NULL,
  PRIMARY KEY (medic_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS schedule_slots (
  schedule_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  center_id SMALLINT UNSIGNED NOT NULL,
  specialty_id SMALLINT UNSIGNED NOT NULL,
  medic_id SMALLINT UNSIGNED NOT NULL,
  starts_at_utc DATETIME NOT NULL,
  ends_at_utc DATETIME NOT NULL,
  PRIMARY KEY (schedule_id),
  UNIQUE KEY uq_schedule_slots_medic_start (medic_id, starts_at_utc),
  KEY idx_schedule_slots_lookup (center_id, specialty_id, medic_id, starts_at_utc),
  CONSTRAINT fk_schedule_slots_center FOREIGN KEY (center_id)
    REFERENCES medical_centers (center_id),
  CONSTRAINT fk_schedule_slots_specialty FOREIGN KEY (specialty_id)
    REFERENCES specialties (specialty_id),
  CONSTRAINT fk_schedule_slots_medic FOREIGN KEY (medic_id)
    REFERENCES medics (medic_id),
  CONSTRAINT ck_schedule_slots_duration
    CHECK (ends_at_utc = DATE_ADD(starts_at_utc, INTERVAL 30 MINUTE)),
  CONSTRAINT ck_schedule_slots_half_hour
    CHECK (MINUTE(starts_at_utc) IN (0, 30) AND SECOND(starts_at_utc) = 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS appointments (
  appointment_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  insured_id CHAR(5) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  schedule_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (appointment_id),
  UNIQUE KEY uq_appointments_schedule (schedule_id),
  KEY idx_appointments_insured (insured_id),
  CONSTRAINT fk_appointments_schedule FOREIGN KEY (schedule_id)
    REFERENCES schedule_slots (schedule_id),
  CONSTRAINT ck_appointments_insured_id
    CHECK (insured_id REGEXP '^[0-9]{5}$')
) ENGINE=InnoDB;

INSERT INTO schema_migrations (version) VALUES ('001_create_schema');
