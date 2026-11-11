-- Both existing and new accounts share nothing until the owner opts in.
ALTER TABLE "User" ADD COLUMN "publicWishlistCategories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "User" ADD CONSTRAINT "User_publicWishlistCategories_allowed"
  CHECK ("publicWishlistCategories" <@ ARRAY['manual', 'decks', 'members', 'sets']::TEXT[]);
