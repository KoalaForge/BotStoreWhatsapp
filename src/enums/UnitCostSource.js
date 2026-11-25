/**
 * Where a unit cost came from. Mirrors App\Enums\Stock\UnitCostSource in the backend.
 */
const UnitCostSource = Object.freeze({
    INPUT: 'input',
    ESTIMATED: 'estimated',
    UNKNOWN: 'unknown'
});

const UNIT_COST_SOURCES = Object.freeze(Object.values(UnitCostSource));

/**
 * A missing cost is always unknown. A cost without a marker stays unmarked:
 * it must never be read as input.
 */
function resolveUnitCostSource(unitCost, source) {
    if (unitCost === null || unitCost === undefined) return UnitCostSource.UNKNOWN;
    return UNIT_COST_SOURCES.includes(source) ? source : undefined;
}

module.exports = { UnitCostSource, UNIT_COST_SOURCES, resolveUnitCostSource };
