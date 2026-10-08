// Companies & branches module (multi_company). Arabic lives in ../ar/companies.ts and must stay complete.
export const enCompanies = {
  "companies.title": "Companies & branches",
  "companies.subtitle": "Legal entities and branches, and what belongs to each.",

  // Tabs
  "companies.tab.branches": "Branches",
  "companies.tab.companies": "Companies",

  // Companies
  "companies.newCompany": "New company",
  "companies.editCompany": "Edit company",
  "companies.deleteCompany": "Delete company",
  "companies.deleteCompanyConfirm":
    "Delete {name}? A company that still has branches cannot be deleted; move or delete its branches first.",
  "companies.legalName": "Legal name",
  "companies.tradeName": "Trade name",
  "companies.nameAr": "Arabic name",
  "companies.crNumber": "CR number",
  "companies.taxNumber": "Tax number",
  "companies.currency": "Currency",
  "companies.currencyHint": "Three-letter code, e.g. OMR. Leave blank to use the account currency.",
  "companies.isDefault": "Default company",
  "companies.isDefaultHint": "New branches belong to it unless you pick another.",
  "companies.default": "Default",
  "companies.companiesEmptyTitle": "No companies yet",
  "companies.companiesEmptyDesc": "Add each legal entity you operate under, with its CR and tax numbers.",
  "companies.companySaveFailed": "Could not save the company.",

  // Branches
  "companies.newBranch": "New branch",
  "companies.editBranch": "Edit branch",
  "companies.deleteBranch": "Delete branch",
  "companies.deleteBranchConfirm":
    "Delete {name}? Vehicles, drivers, employees and warehouses in it stay, but no longer belong to a branch.",
  "companies.branch": "Branch",
  "companies.noBranch": "No branch",
  "companies.allBranches": "All branches",
  "companies.branchName": "Name",
  "companies.code": "Code",
  "companies.company": "Company",
  "companies.noCompany": "No company",
  "companies.allCompanies": "All companies",
  "companies.manager": "Branch manager",
  "companies.city": "City",
  "companies.country": "Country",
  "companies.address": "Address",
  "companies.active": "Active",
  "companies.inactive": "Inactive",
  "companies.activeOnly": "Active branches",
  "companies.allStatuses": "All branches",
  "companies.searchBranches": "Search name, code or city…",
  "companies.branchesEmptyTitle": "No branches yet",
  "companies.branchesEmptyDesc": "Add your sites, depots and offices, then assign vehicles and people to them.",
  "companies.branchesEmptyFilteredTitle": "No matching branches",
  "companies.branchesEmptyFilteredDesc": "Try a different search or clear the filters.",
  "companies.branchSaveFailed": "Could not save the branch.",
  "companies.branchNotFound": "This branch does not exist or was deleted.",
  "companies.details": "Details",

  // What belongs to a branch
  "companies.vehicles": "Vehicles",
  "companies.drivers": "Drivers",
  "companies.employees": "Employees",
  "companies.warehouses": "Warehouses",
  "companies.nothingHere": "None assigned to this branch.",
  "companies.andMore": { one: "and {count} more", other: "and {count} more" },
  "companies.assignHint": "Assign a vehicle or driver to this branch from its own form.",
} as const;
