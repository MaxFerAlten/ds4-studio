import Mathlib.Data.Nat.Choose.Sum

-- Conventional order: decreasing powers of x, so the first term (k = 0)
-- is x^n. Reindexing the whole sum does not preserve the term's position.
theorem binomial_expansion (x y : ℚ) (n : ℕ) :
    (x + y)^n = ∑ k ∈ Finset.range (n + 1), (n.choose k : ℚ) * x^(n-k) * y^k := by
  simpa [add_comm, mul_comm, mul_left_comm, mul_assoc] using (add_pow y x n)

-- With n = 3, x = 2, y = 3, the conventional first term is 8, not 27.
example : (Nat.choose 3 0 : ℕ) * 2^(3-0) * 3^0 = 8 := by decide
example : (Nat.choose 3 0 : ℕ) * 2^0 * 3^(3-0) = 27 := by decide

-- At r = 1, option D is the second term; option A gives the third term.
example : (Nat.choose 3 1 : ℕ) * 2^(3-1) * 3^1 = 36 := by decide
example : (Nat.choose 3 1 : ℕ) * 2^1 * 3^(3-1) = 54 := by decide
