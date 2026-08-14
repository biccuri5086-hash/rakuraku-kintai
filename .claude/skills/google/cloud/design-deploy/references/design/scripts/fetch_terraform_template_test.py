import subprocess
from unittest import mock

from absl.testing import absltest

import fetch_terraform_template


class FetchTerraformTemplateTest(absltest.TestCase):

  @mock.patch("subprocess.run")
  def test_run_cmd_success(self, mock_run: mock.Mock) -> None:
    mock_run.return_value = mock.Mock(stdout="success output")
    res = fetch_terraform_template._run_cmd(["gcloud", "--version"])
    self.assertEqual(res, "success output")

  @mock.patch("subprocess.run")
  def test_run_cmd_failure(self, mock_run: mock.Mock) -> None:
    mock_run.side_effect = subprocess.CalledProcessError(1, ["cmd"])
    with self.assertRaises(subprocess.CalledProcessError):
      fetch_terraform_template._run_cmd(["invalid_cmd"])

  def test_parse_input_short_id(self) -> None:
    res = fetch_terraform_template._parse_input("my-template")
    self.assertEqual(
        res,
        (
            "gcpdesigncenter",
            "us-central1",
            "googlespace",
            "googlecatalog",
            "my-template",
        ),
    )

  def test_parse_input_full_path(self) -> None:
    full_path = (
        "projects/my-proj/locations/us-east1/spaces/my-sp/catalogs/my-cat/"
        "templates/tpl-123"
    )
    res = fetch_terraform_template._parse_input(full_path)
    self.assertEqual(res, ("my-proj", "us-east1", "my-sp", "my-cat", "tpl-123"))


if __name__ == "__main__":
  absltest.main()
