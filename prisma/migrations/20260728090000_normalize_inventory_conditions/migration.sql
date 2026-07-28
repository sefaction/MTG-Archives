UPDATE "InventoryItem"
SET "condition" = CASE
  WHEN regexp_replace(upper(trim("condition")), '[^A-Z0-9]+', '', 'g') IN ('NM', 'NEARMINT') THEN 'NM'
  WHEN regexp_replace(upper(trim("condition")), '[^A-Z0-9]+', '', 'g') IN ('LP', 'LIGHTLYPLAYED', 'SP', 'SLIGHTLYPLAYED') THEN 'LP'
  WHEN regexp_replace(upper(trim("condition")), '[^A-Z0-9]+', '', 'g') IN ('MP', 'MODERATELYPLAYED') THEN 'MP'
  WHEN regexp_replace(upper(trim("condition")), '[^A-Z0-9]+', '', 'g') IN ('HP', 'HEAVILYPLAYED') THEN 'HP'
  WHEN regexp_replace(upper(trim("condition")), '[^A-Z0-9]+', '', 'g') IN ('DMG', 'DAMAGED', 'POOR') THEN 'DMG'
  ELSE upper(trim("condition"))
END;

UPDATE "ImportBatchItem"
SET "parsedCondition" = CASE
  WHEN regexp_replace(upper(trim("parsedCondition")), '[^A-Z0-9]+', '', 'g') IN ('NM', 'NEARMINT') THEN 'NM'
  WHEN regexp_replace(upper(trim("parsedCondition")), '[^A-Z0-9]+', '', 'g') IN ('LP', 'LIGHTLYPLAYED', 'SP', 'SLIGHTLYPLAYED') THEN 'LP'
  WHEN regexp_replace(upper(trim("parsedCondition")), '[^A-Z0-9]+', '', 'g') IN ('MP', 'MODERATELYPLAYED') THEN 'MP'
  WHEN regexp_replace(upper(trim("parsedCondition")), '[^A-Z0-9]+', '', 'g') IN ('HP', 'HEAVILYPLAYED') THEN 'HP'
  WHEN regexp_replace(upper(trim("parsedCondition")), '[^A-Z0-9]+', '', 'g') IN ('DMG', 'DAMAGED', 'POOR') THEN 'DMG'
  ELSE upper(trim("parsedCondition"))
END
WHERE "parsedCondition" IS NOT NULL;
