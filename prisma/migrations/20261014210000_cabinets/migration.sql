-- AlterEnum
ALTER TYPE "AssetType" ADD VALUE 'CABINET';

-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "cabinetId" TEXT,
ADD COLUMN     "rackPosition" INTEGER,
ADD COLUMN     "rackUnits" INTEGER;

-- Map positions are now only used for access points and cabinets; clear
-- any earlier values so every device starts from its automatic position.
UPDATE "Asset" SET "mapX" = NULL, "mapY" = NULL;

-- CreateIndex
CREATE INDEX "Asset_cabinetId_idx" ON "Asset"("cabinetId");

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_cabinetId_fkey" FOREIGN KEY ("cabinetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
