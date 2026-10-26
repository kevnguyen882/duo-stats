import unittest

from duostats.grades import best_grade, better, grade_rank, is_s_rank


class GradeTests(unittest.TestCase):
    def test_rank_order(self):
        self.assertLess(grade_rank("S+"), grade_rank("S"))
        self.assertLess(grade_rank("S-"), grade_rank("A+"))
        self.assertEqual(grade_rank(" s+ "), 0)   # case and spaces don't matter

    def test_unknown_grade_ranks_last(self):
        for g in ("", None, "Z", "SS"):
            self.assertEqual(grade_rank(g), 99)

    def test_s_rank_is_s_minus_or_better(self):
        self.assertTrue(all(is_s_rank(g) for g in ("S+", "S", "S-")))
        self.assertFalse(any(is_s_rank(g) for g in ("A+", "", None)))

    def test_better(self):
        self.assertEqual(better("A", "S-"), "S-")
        self.assertEqual(better("S+", "S"), "S+")
        self.assertEqual(better("B", ""), "B")   # a grade beats no grade

    def test_best_grade_takes_season_best_or_milestones(self):
        self.assertEqual(best_grade({"highestGrade": "A", "milestoneGrades": ["B", "S-", None]}), "S-")
        self.assertEqual(best_grade({"highestGrade": "S+", "milestoneGrades": ["S"]}), "S+")
        self.assertEqual(best_grade({"milestoneGrades": ["C", "B+"]}), "B+")
        self.assertEqual(best_grade({}), "")


if __name__ == "__main__":
    unittest.main()
