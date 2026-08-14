import subprocess
from unittest import mock

from absl.testing import absltest

import list_terraform_templates


class ListTerraformTemplatesTest(absltest.TestCase):

  @mock.patch("subprocess.run")
  def test_run_gcloud_list_success(self, mock_run: mock.Mock) -> None:
    mock_run.return_value = mock.Mock(
        stdout='[{"name": "app1", "templateCategory": "APPLICATION_TEMPLATE"}]'
    )
    res = list_terraform_templates._run_gcloud_list(
        project="p", location="l", space="s", catalog="c"
    )
    self.assertEqual(
        res, [{"name": "app1", "templateCategory": "APPLICATION_TEMPLATE"}]
    )

  @mock.patch("subprocess.run")
  def test_run_gcloud_list_failure(self, mock_run: mock.Mock) -> None:
    mock_run.side_effect = subprocess.CalledProcessError(
        1, ["cmd"], stderr="err"
    )
    res = list_terraform_templates._run_gcloud_list("p", "l", "s", "c")
    self.assertEqual(res, [])


if __name__ == "__main__":
  absltest.main()
