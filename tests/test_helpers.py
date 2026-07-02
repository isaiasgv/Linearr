"""Pure-helper unit tests."""
import main


def test_parse_version_basic():
    assert main._parse_version("1.2.10") == (1, 2, 10)
    assert main._parse_version("v1.3.6") == (1, 3, 6)
    assert main._parse_version("1.3.0-rc.4") == (1, 3, 0)


def test_parse_version_garbage():
    assert main._parse_version("not-a-version") == (0,)


def test_parse_version_ordering():
    assert main._parse_version("1.2.10") > main._parse_version("1.2.9")
    assert main._parse_version("1.3.0") >= main._parse_version("1.2.10")


def test_hours_in_block_simple():
    hours = main._hours_in_block("09:00", "12:00")
    assert hours == ["09:00", "10:00", "11:00"]
