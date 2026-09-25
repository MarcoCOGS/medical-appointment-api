SET time_zone = '+00:00';
START TRANSACTION;

INSERT INTO medical_centers (center_id, name, time_zone) VALUES
  (1, 'Centro Demo Santiago Centro', 'America/Santiago'),
  (2, 'Centro Demo Santiago Oriente', 'America/Santiago');

INSERT INTO specialties (specialty_id, name) VALUES
  (1, 'Medicina general'),
  (2, 'Cardiología');

INSERT INTO medics (medic_id, full_name) VALUES
  (1, 'Dra. Camila Silva (demo)'),
  (2, 'Dr. Martín Soto (demo)');

INSERT INTO schema_migrations (version) VALUES ('002_seed_catalog');
COMMIT;
