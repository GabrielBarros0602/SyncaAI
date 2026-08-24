"""Access to tags."""

from syncaai.models import Tag
from syncaai.repositories.base import OwnedRepository


class TagRepository(OwnedRepository[Tag]):
    """Owner-scoped, which is what makes get-or-create safe.

    Without the scoping, naming a tag that another user already has would attach a task to
    somebody else's row — the exact failure ADR-0016 exists to prevent, arriving through a
    door nobody would think to check.
    """

    model = Tag
    owner_column = Tag.user_id
    # Alphabetical, because this list is rendered as one. Insertion order would put the tag
    # a user made three months ago wherever it happened to land.
    default_order = (Tag.name,)

    def get_or_create(self, name: str) -> Tag:
        """Return this owner's tag with that name, creating it if it is new.

        There is no endpoint that creates a tag directly (ADR-0020): a tag exists because a
        task named it.
        """
        existing = self._session.scalar(self._scoped().where(Tag.name == name))
        if existing is not None:
            return existing

        tag = Tag(user_id=self._owner_id, name=name)
        self.add(tag)
        return tag
