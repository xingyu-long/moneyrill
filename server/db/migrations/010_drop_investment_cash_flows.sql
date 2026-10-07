-- The portfolio return takes its cash flow live from the Reports lines (income minus spending, transfers left
-- out), so the table of recorded monthly figures from 009 is not used. Nothing else refers to it.
DROP TABLE IF EXISTS investment_cash_flows;
