/**
 * SQL that selects wage-or-other employees together with their computed status and current contract.
 *
 * Parameters are numbered: `?1` is the company ID and `?2` today's date.
 * Callers append `AND …` conditions to the outer query using `?3` onwards.
 * A leave counts from its start date until the day before the actual return
 * date, or through its end date when the employee has not returned yet.
 */
export const EMPLOYEE_VIEW_SQL = `
WITH base AS (
  SELECT e.*,
    d.name AS department_name,
    p.name AS position_name,
    COALESCE(r.leave_date, n.leave_date) AS leave_date,
    CASE
      WHEN COALESCE(r.leave_date, n.leave_date) IS NOT NULL AND COALESCE(r.leave_date, n.leave_date) < ?2 THEN 'RESIGNED'
      WHEN e.join_date IS NOT NULL AND e.join_date > ?2 THEN 'PRE_JOINED'
      WHEN EXISTS (
        SELECT 1 FROM employee_leaves l
        WHERE l.company_id = e.company_id AND l.employee_id = e.id AND l.start_date <= ?2
          AND ?2 < COALESCE(l.actual_return_date, date(l.end_date, '+1 day'))
      ) THEN 'LEAVE'
      ELSE 'JOINED'
    END AS status,
    (
      SELECT w.id FROM employee_work_contracts w
      WHERE w.company_id = e.company_id AND w.employee_id = e.id
      ORDER BY CASE WHEN w.start_date <= ?2 THEN 0 ELSE 1 END,
               CASE WHEN w.start_date <= ?2 THEN w.start_date END DESC,
               w.start_date, w.id DESC
      LIMIT 1
    ) AS current_contract_id
  FROM employees e
  LEFT JOIN departments d ON d.company_id = e.company_id AND d.id = e.department_id
  LEFT JOIN positions p ON p.company_id = e.company_id AND p.id = e.position_id
  LEFT JOIN employee_retirement_infos r ON r.company_id = e.company_id AND r.employee_id = e.id
  LEFT JOIN employee_non_wage_details n ON n.company_id = e.company_id AND n.employee_id = e.id
  WHERE e.company_id = ?1
),
employee_view AS (
  SELECT base.*,
    c.contract_type AS contract_type,
    c.end_date AS contract_end_date,
    CASE WHEN c.end_date IS NOT NULL AND EXISTS (
      SELECT 1 FROM employee_work_contracts later
      WHERE later.company_id = base.company_id AND later.employee_id = base.id AND later.start_date > c.end_date
    ) THEN 1 ELSE 0 END AS contract_followed
  FROM base
  LEFT JOIN employee_work_contracts c ON c.id = base.current_contract_id
)
SELECT * FROM employee_view WHERE 1 = 1`
