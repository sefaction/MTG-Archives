ALTER TABLE "InventoryLocation" ADD COLUMN "capacityRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "InventoryLocation" ADD CONSTRAINT "InventoryLocation_capacityRevision_nonnegative" CHECK ("capacityRevision" >= 0);

-- Statement transition tables avoid one location update per stock row in bulk
-- imports/moves. Lock affected locations in identifier order. The revision and
-- stock write commit or roll back together, including direct SQL/FK actions.
CREATE FUNCTION mtg_touch_inventory_capacity(location_ids TEXT[]) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE location_id TEXT;
BEGIN
  FOR location_id IN SELECT DISTINCT x FROM unnest(location_ids) AS x WHERE x IS NOT NULL ORDER BY x LOOP
    UPDATE public."InventoryLocation" SET "capacityRevision" = "capacityRevision" + 1 WHERE id = location_id;
  END LOOP;
END;
$$;

CREATE FUNCTION mtg_inventory_capacity_insert() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM mtg_touch_inventory_capacity(ARRAY(SELECT "locationId" FROM new_stock WHERE quantity > 0));
  RETURN NULL;
END;
$$;
CREATE FUNCTION mtg_inventory_capacity_delete() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM mtg_touch_inventory_capacity(ARRAY(SELECT "locationId" FROM old_stock WHERE quantity > 0));
  RETURN NULL;
END;
$$;
CREATE FUNCTION mtg_inventory_capacity_update() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM mtg_touch_inventory_capacity(ARRAY(
    SELECT location_id FROM (
      SELECT o."locationId" AS old_location, n."locationId" AS new_location
      FROM old_stock o FULL JOIN new_stock n USING (id)
      WHERE (o.quantity > 0 OR n.quantity > 0)
        AND ROW(o.quantity, o."locationId", o."locationSection", o."currentOwnerId")
          IS DISTINCT FROM ROW(n.quantity, n."locationId", n."locationSection", n."currentOwnerId")
    ) changed CROSS JOIN LATERAL (VALUES (old_location), (new_location)) AS affected(location_id)
  ));
  RETURN NULL;
END;
$$;
CREATE FUNCTION mtg_inventory_capacity_truncate() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM mtg_touch_inventory_capacity(ARRAY(SELECT id FROM public."InventoryLocation"));
  RETURN NULL;
END;
$$;
CREATE TRIGGER mtg_inventory_capacity_insert AFTER INSERT ON "InventoryItem"
  REFERENCING NEW TABLE AS new_stock FOR EACH STATEMENT EXECUTE FUNCTION mtg_inventory_capacity_insert();
CREATE TRIGGER mtg_inventory_capacity_update AFTER UPDATE ON "InventoryItem"
  REFERENCING OLD TABLE AS old_stock NEW TABLE AS new_stock FOR EACH STATEMENT EXECUTE FUNCTION mtg_inventory_capacity_update();
CREATE TRIGGER mtg_inventory_capacity_delete AFTER DELETE ON "InventoryItem"
  REFERENCING OLD TABLE AS old_stock FOR EACH STATEMENT EXECUTE FUNCTION mtg_inventory_capacity_delete();
CREATE TRIGGER mtg_inventory_capacity_truncate AFTER TRUNCATE ON "InventoryItem"
  FOR EACH STATEMENT EXECUTE FUNCTION mtg_inventory_capacity_truncate();

-- Ordinary location edits already lock the row. Advance the same token when a
-- placement-relevant fact changes; capacity-only touches do not recurse.
CREATE FUNCTION mtg_location_capacity_layout() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(OLD."ownerPlayerId", OLD."parentLocationId", OLD.name, OLD.type, OLD."storageLayout", OLD.kind, OLD."systemManaged", OLD.active)
    IS DISTINCT FROM ROW(NEW."ownerPlayerId", NEW."parentLocationId", NEW.name, NEW.type, NEW."storageLayout", NEW.kind, NEW."systemManaged", NEW.active) THEN
    NEW."capacityRevision" := OLD."capacityRevision" + 1;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER mtg_location_capacity_layout BEFORE UPDATE ON "InventoryLocation"
  FOR EACH ROW EXECUTE FUNCTION mtg_location_capacity_layout();
