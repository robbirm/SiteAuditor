-- CreateEnum
CREATE TYPE "CableType" AS ENUM ('CAT5E', 'CAT6', 'CAT6A', 'CAT7', 'FIBRE_SM', 'FIBRE_MM', 'COAX', 'OTHER');

-- CreateTable
CREATE TABLE "CableRun" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "floorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CableType" NOT NULL DEFAULT 'CAT6',
    "points" JSONB NOT NULL,
    "lengthMetres" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fromRoomId" TEXT,
    "toRoomId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CableRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CableRun_organisationId_schoolId_idx" ON "CableRun"("organisationId", "schoolId");

-- CreateIndex
CREATE INDEX "CableRun_floorId_idx" ON "CableRun"("floorId");

-- AddForeignKey
ALTER TABLE "CableRun" ADD CONSTRAINT "CableRun_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CableRun" ADD CONSTRAINT "CableRun_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CableRun" ADD CONSTRAINT "CableRun_floorId_fkey" FOREIGN KEY ("floorId") REFERENCES "Floor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CableRun" ADD CONSTRAINT "CableRun_fromRoomId_fkey" FOREIGN KEY ("fromRoomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CableRun" ADD CONSTRAINT "CableRun_toRoomId_fkey" FOREIGN KEY ("toRoomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;
