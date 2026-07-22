-- Runs once on first PostgreSQL initialization (empty data volume).
-- Creates the per-service databases used by docker-compose.
CREATE DATABASE aed_registry_ingestor;
CREATE DATABASE osm_ingestor;
